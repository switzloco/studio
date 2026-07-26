#!/usr/bin/env node
/**
 * Static cost model for the CFO Fitness AI stack.
 *
 * Reads the real prompt + tool definitions out of the source tree (so the
 * numbers track the code instead of going stale in a doc) and models what a
 * single chat message actually bills.
 *
 * The thing this exists to make visible: the agentic tool loop resends the
 * ENTIRE context on every turn. A 15-turn ceiling over a ~14k-token static
 * preamble is quadratic, not linear, and that is where the money goes.
 *
 * Usage:
 *   node scripts/cost-model.mjs
 *   node scripts/cost-model.mjs --msgs-per-day 30
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
};

// --- Pricing -----------------------------------------------------------------
// Gemini 2.5 Flash, USD per 1M tokens. Thinking tokens bill at the OUTPUT rate.
// Verify against https://ai.google.dev/pricing before trusting to the cent.
const PRICE = {
  inputPerM: 0.30,
  outputPerM: 2.50,
  // Implicit context caching on 2.5 models discounts a repeated prefix by ~75%,
  // but only on a cache hit (short TTL, needs an exact shared prefix).
  cachedInputDiscount: 0.75,
};

// Cloud Run (Firebase App Hosting) — us-central1 list price, USD.
const CLOUD_RUN = {
  idleVCpuSec: 0.0000025,   // min-instance idle CPU
  memGiBSec: 0.0000025,
  activeVCpuSec: 0.000024,
};

const TOK = (chars) => Math.round(chars / 4); // ~4 chars/token for English prose

// --- Measure the real prompt surface ----------------------------------------
function readSrc(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** Pull a template-literal block assigned to `key:` out of a source file. */
function templateBlocks(src, key) {
  const out = [];
  const re = new RegExp(`${key}: \``, 'g');
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    for (; i < src.length; i++) {
      if (src[i] === '\\') { i++; continue; }
      if (src[i] === '`') break;
    }
    out.push(src.slice(m.index + m[0].length, i));
  }
  return out;
}

/** Size of every ai.defineTool() config object — proxy for the JSON-Schema
 *  tool declarations serialized into every single model request. */
function toolSchemaChars(src) {
  const rows = [];
  for (const m of src.matchAll(/ai\.defineTool\(\s*\{/g)) {
    let i = src.indexOf('{', m.index);
    let depth = 0, j = i;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    const cfg = src.slice(i, j);
    rows.push({ name: (cfg.match(/name: '([^']+)'/) || [])[1] ?? '?', chars: cfg.length });
  }
  return rows.sort((a, b) => b.chars - a.chars);
}

const coach = readSrc('src/ai/flows/personalized-ai-coaching.ts');
const nutrition = readSrc('src/ai/tools/nutrition-lookup.ts');

const systemBlocks = templateBlocks(coach, 'system');
const cfoSystemTok = TOK(systemBlocks[0]?.length ?? 0);
const tools = [...toolSchemaChars(coach), ...toolSchemaChars(nutrition)];
const toolsTok = TOK(tools.reduce((a, t) => a + t.chars, 0));

// Observed/assumed runtime inputs.
const HISTORY_TURNS = 12;          // MAX_SENT_HISTORY in src/app/api/chat/route.ts
const HISTORY_TOK_PER_TURN = 150;  // verbose CFO replies; conservative
const IMAGE_TOK = 3000;            // full-res phone photo, no client downscale
const TOOL_RESULT_TOK = 1200;      // get_user_context / get_recent_logs payload
const THINKING_TOK_PER_TURN = 400; // 2.5 Flash dynamic thinking, no budget set
const FINAL_ANSWER_TOK = 600;

const staticPreambleTok = cfoSystemTok + toolsTok;

// --- Model one message through the agentic loop ------------------------------
/**
 * Genkit resends the whole conversation on every tool round trip, so input
 * tokens accumulate as a running sum, not a flat per-call cost.
 */
function costOfMessage({ toolTurns, withImage, cacheHitRate = 0, thinkingTok = THINKING_TOK_PER_TURN }) {
  const base =
    staticPreambleTok +
    HISTORY_TURNS * HISTORY_TOK_PER_TURN +
    (withImage ? IMAGE_TOK : 0) +
    60; // the user's actual message

  let inputTok = 0;
  let outputTok = 0;
  let ctx = base;

  const calls = toolTurns + 1; // N tool round trips + the final answer
  for (let t = 0; t < calls; t++) {
    inputTok += ctx;
    const isFinal = t === calls - 1;
    const out = thinkingTok + (isFinal ? FINAL_ANSWER_TOK : 80 /* tool-call JSON */);
    outputTok += out;
    ctx += TOOL_RESULT_TOK + out; // tool result + the model's own turn re-enter context
  }

  // Only the static preamble is prefix-cacheable.
  const cacheableTok = Math.min(staticPreambleTok * calls, inputTok) * cacheHitRate;
  const billedInput = inputTok - cacheableTok * PRICE.cachedInputDiscount;

  return {
    inputTok,
    outputTok,
    billedInput: Math.round(billedInput),
    usd: (billedInput / 1e6) * PRICE.inputPerM + (outputTok / 1e6) * PRICE.outputPerM,
  };
}

// --- Report ------------------------------------------------------------------
const msgsPerDay = arg('msgs-per-day', 20);
const fmt = (n) => `$${n.toFixed(4)}`;
const usd = (n) => `$${n.toFixed(2)}`;

console.log('\n=== STATIC PER-REQUEST OVERHEAD (billed on EVERY model call) ===');
console.log(`  CFO system prompt      ${String(cfoSystemTok).padStart(6)} tok`);
console.log(`  Tool JSON-Schemas (${String(tools.length).padStart(2)})  ${String(toolsTok).padStart(6)} tok`);
console.log(`  ${'-'.repeat(34)}`);
console.log(`  Static preamble        ${String(staticPreambleTok).padStart(6)} tok  ${fmt((staticPreambleTok / 1e6) * PRICE.inputPerM)} per call`);

console.log('\n  Heaviest tool schemas:');
for (const t of tools.slice(0, 5)) {
  console.log(`    ${String(TOK(t.chars)).padStart(5)} tok  ${t.name}`);
}

console.log('\n=== COST OF ONE CHAT MESSAGE (agentic loop, no cache hit) ===');
const scenarios = [
  ['simple reply (0 tool calls)', { toolTurns: 0, withImage: false }],
  ['text meal log (3 tool calls)', { toolTurns: 3, withImage: false }],
  ['photo meal log (4 tool calls)', { toolTurns: 4, withImage: true }],
  ['worst case (maxTurns: 15)', { toolTurns: 15, withImage: true }],
];
for (const [label, opts] of scenarios) {
  const r = costOfMessage(opts);
  console.log(
    `  ${label.padEnd(30)} in ${String(r.inputTok).padStart(7)} tok  out ${String(r.outputTok).padStart(6)} tok  ${fmt(r.usd)}`,
  );
}

console.log('\n=== MONTHLY, ONE ACTIVE USER ===');
const mix = () =>
  0.4 * costOfMessage({ toolTurns: 0, withImage: false }).usd +
  0.4 * costOfMessage({ toolTurns: 3, withImage: false }).usd +
  0.2 * costOfMessage({ toolTurns: 4, withImage: true }).usd;

const geminiMonth = mix() * msgsPerDay * 30;
const SEC_PER_MONTH = 30 * 24 * 3600;
const cloudRunIdle =
  SEC_PER_MONTH * CLOUD_RUN.idleVCpuSec + SEC_PER_MONTH * 0.5 * CLOUD_RUN.memGiBSec;

console.log(`  Gemini 2.5 Flash  (${msgsPerDay} msgs/day)        ${usd(geminiMonth)}`);
console.log(`  Cloud Run minInstances:1 idle          ${usd(cloudRunIdle)}   <- billed 24/7 at ZERO users`);
console.log(`  ${'-'.repeat(40)}`);
console.log(`  Total                                  ${usd(geminiMonth + cloudRunIdle)}`);

console.log('\n=== PROJECTED SAVINGS ===');
const savings = [
  [
    'Cap thinking budget (thinkingConfig)',
    () => 0.4 * costOfMessage({ toolTurns: 0, withImage: false, thinkingTok: 0 }).usd +
          0.4 * costOfMessage({ toolTurns: 3, withImage: false, thinkingTok: 0 }).usd +
          0.2 * costOfMessage({ toolTurns: 4, withImage: true, thinkingTok: 0 }).usd,
  ],
  [
    'Explicit prefix cache (~90% hit rate)',
    () => 0.4 * costOfMessage({ toolTurns: 0, withImage: false, cacheHitRate: 0.9 }).usd +
          0.4 * costOfMessage({ toolTurns: 3, withImage: false, cacheHitRate: 0.9 }).usd +
          0.2 * costOfMessage({ toolTurns: 4, withImage: true, cacheHitRate: 0.9 }).usd,
  ],
  [
    'Both, together',
    () => 0.4 * costOfMessage({ toolTurns: 0, withImage: false, cacheHitRate: 0.9, thinkingTok: 0 }).usd +
          0.4 * costOfMessage({ toolTurns: 3, withImage: false, cacheHitRate: 0.9, thinkingTok: 0 }).usd +
          0.2 * costOfMessage({ toolTurns: 4, withImage: true, cacheHitRate: 0.9, thinkingTok: 0 }).usd,
  ],
];
for (const [label, fn] of savings) {
  const after = fn() * msgsPerDay * 30;
  const pct = ((1 - after / geminiMonth) * 100).toFixed(0);
  console.log(`  ${label.padEnd(38)} ${usd(after)}/mo  (-${pct}%)`);
}
console.log(`  ${'minInstances: 1 -> 0'.padEnd(38)} ${usd(0)}/mo  (-${usd(cloudRunIdle)} fixed)\n`);

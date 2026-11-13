import { FieldValue } from 'firebase-admin/firestore';
import type { ModelMiddlewareWithOptions } from 'genkit/model';
import { getAdminFirestore } from '@/firebase/admin';
import { CFO_MODEL } from '@/ai/genkit';

/**
 * @fileOverview Per-user AI token + cost tracking.
 *
 * Attach `trackAiUsage({ uid, feature, model })` to any Genkit generate / prompt
 * call via the `use` option. Genkit runs model middleware on EVERY model call,
 * including each step of a multi-turn tool loop, so the numbers reflect what
 * Vertex AI actually bills — not just the final reply.
 *
 * Firestore layout (server-only; no client rules grant access):
 *   ai_usage/{uid}                         → { lastCallAt, tier }
 *   ai_usage/{uid}/months/{YYYY-MM}        → token totals, costUsd, features.*, models.*
 *   ai_usage/{uid}/days/{YYYY-MM-DD}       → token totals, costUsd, features.*
 *   ai_usage_monthly/{YYYY-MM}             → global totals, features.*, users.{uid}.*
 *
 * Every call also emits a structured `ai_usage` JSON log line for Cloud Logging.
 *
 * Run `npx tsx scripts/ai-usage-report.ts [YYYY-MM]` for a per-user cost table.
 */

export type AiFeature =
  | 'chat'
  | 'ledger_chat'
  | 'data_analyst'
  | 'transcribe'
  | 'share_ingestion'
  | 'shared_meal_edit'
  | 'welcome_assessment'
  | 'admin_report'
  | 'outreach_meal_parse';

/**
 * USD per 1M tokens. ⚠️ VERIFY against current Vertex AI pricing
 * (https://cloud.google.com/vertex-ai/generative-ai/pricing) — these are
 * estimates. Thinking tokens bill at the output rate; cached input tokens bill
 * at `cachedInput`. First matching substring wins, so list specific names first.
 */
const PRICING: { match: string; input: number; cachedInput: number; output: number }[] = [
  { match: 'flash-lite', input: 0.10, cachedInput: 0.025, output: 0.40 },
  { match: 'flash',      input: 0.50, cachedInput: 0.125, output: 3.00 },
  { match: 'pro',        input: 2.00, cachedInput: 0.50,  output: 12.00 },
];
const FALLBACK_PRICE = PRICING[1];

export interface AiUsageContext {
  /** Firebase uid, or a synthetic id like `public:shared_meal` / `system:admin`. */
  uid: string;
  feature: AiFeature;
  /** Model actually used for this call. Defaults to CFO_MODEL. */
  model?: string;
  /** Optional entitlement tier, stored on the user's usage doc for reporting. */
  tier?: string;
}

export interface AiUsageSample {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
}

export function estimateCostUsd(model: string, u: AiUsageSample): number {
  const p = PRICING.find((x) => model.includes(x.match)) ?? FALLBACK_PRICE;
  const uncachedInput = Math.max(0, u.inputTokens - u.cachedTokens);
  return (
    (uncachedInput * p.input +
      u.cachedTokens * p.cachedInput +
      (u.outputTokens + u.thoughtsTokens) * p.output) /
    1_000_000
  );
}

/** Firestore map keys can't contain `/` or `.`. */
function safeKey(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function increments(u: AiUsageSample, costUsd: number) {
  return {
    calls: FieldValue.increment(1),
    inputTokens: FieldValue.increment(u.inputTokens),
    cachedTokens: FieldValue.increment(u.cachedTokens),
    outputTokens: FieldValue.increment(u.outputTokens),
    thoughtsTokens: FieldValue.increment(u.thoughtsTokens),
    costUsd: FieldValue.increment(costUsd),
  };
}

export async function recordAiUsage(ctx: AiUsageContext, u: AiUsageSample): Promise<void> {
  const model = ctx.model ?? CFO_MODEL;
  const costUsd = estimateCostUsd(model, u);
  const now = new Date();
  const day = now.toISOString().slice(0, 10); // UTC
  const month = day.slice(0, 7);
  const uidKey = safeKey(ctx.uid);
  const modelKey = safeKey(model);
  const small = { calls: FieldValue.increment(1), costUsd: FieldValue.increment(costUsd) };

  console.log(
    JSON.stringify({
      severity: 'INFO',
      message: 'ai_usage',
      uid: ctx.uid,
      feature: ctx.feature,
      model,
      ...u,
      costUsd: Number(costUsd.toFixed(6)),
    }),
  );

  const db = getAdminFirestore();
  const batch = db.batch();
  const userRef = db.doc(`ai_usage/${uidKey}`);

  batch.set(
    userRef,
    {
      uid: ctx.uid,
      lastCallAt: FieldValue.serverTimestamp(),
      ...(ctx.tier ? { tier: ctx.tier } : {}),
    },
    { merge: true },
  );
  batch.set(
    userRef.collection('months').doc(month),
    {
      ...increments(u, costUsd),
      features: { [ctx.feature]: small },
      models: { [modelKey]: small },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  batch.set(
    userRef.collection('days').doc(day),
    {
      ...increments(u, costUsd),
      features: { [ctx.feature]: small },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  batch.set(
    db.doc(`ai_usage_monthly/${month}`),
    {
      ...increments(u, costUsd),
      features: { [ctx.feature]: small },
      users: { [uidKey]: small },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await batch.commit();
}

/**
 * Genkit model middleware that records token usage for every model call.
 * Never throws — tracking failures are logged and the AI response is returned
 * untouched.
 */
export function trackAiUsage(ctx: AiUsageContext): ModelMiddlewareWithOptions {
  return async (req, opts, next) => {
    const res = await next(req, opts);
    try {
      const usage = res?.usage ?? {};
      const sample: AiUsageSample = {
        inputTokens: usage.inputTokens ?? 0,
        cachedTokens: usage.cachedContentTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        thoughtsTokens: usage.thoughtsTokens ?? 0,
      };
      if (sample.inputTokens || sample.outputTokens || sample.thoughtsTokens) {
        await recordAiUsage(ctx, sample);
      }
    } catch (err: any) {
      console.error('[ai-usage] Failed to record usage:', err?.message ?? String(err));
    }
    return res;
  };
}

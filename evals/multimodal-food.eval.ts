/**
 * Multimodal Food/Guardrail Eval — CFO Fitness × Arize Phoenix
 * -----------------------------------------------------------
 * Tests the agent's MULTIMODAL judgment: shown an image, does it (a) estimate
 * macros for real food, and (b) correctly REFUSE to invent macros for things
 * that aren't food? The non-food cases are the guardrail story — proof the
 * agent doesn't hallucinate calories for a shoe or a cat.
 *
 * Every case records a Phoenix span (`eval.multimodal_food`) with the image
 * label, the model's isFood verdict + macros, and a pass/fail.
 *
 * HOW TO ADD IMAGES:
 *   1. Drop image files (jpg/png/webp) into evals/fixtures/.
 *   2. (Optional) list them in evals/fixtures/manifest.json with the expected
 *      verdict so they're scored pass/fail:
 *        [{ "file": "burger.jpg",  "label": "cheeseburger", "expectFood": true },
 *         { "file": "sneaker.jpg", "label": "running shoe", "expectFood": false }]
 *   3. Any image NOT in the manifest is still run "exploratory" — the model's
 *      verdict is printed (great for throwing in a funny pic to see what it says).
 *
 * Run it (same env as the nutrition eval):
 *   npx tsx evals/multimodal-food.eval.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config();

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { ai } from '@/ai/genkit';
import { flushPhoenixTraces } from '@/ai/observability/phoenix';
import { recordReasoningSpan } from '@/ai/observability/span';
import { z } from 'genkit';

const FIXTURES_DIR = join(process.cwd(), 'evals', 'fixtures');
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

interface ManifestEntry {
  file: string;
  label?: string;
  expectFood: boolean;
}

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif',
};

function toDataUri(path: string): string {
  const ext = extname(path).toLowerCase();
  const mime = MIME[ext] ?? 'image/jpeg';
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
}

const VerdictSchema = z.object({
  isFood: z.boolean().describe('true only if the image shows food or drink a person would eat'),
  itemName: z.string().describe('what the image shows (e.g. "cheeseburger" or "running shoe")'),
  calories: z.number().describe('estimated calories for a typical portion; 0 if not food'),
  proteinG: z.number(),
  carbsG: z.number(),
  fatG: z.number(),
  note: z.string().describe('one short sentence — your CFO take, or why it is not food'),
});

async function classifyImage(dataUri: string) {
  const { output } = await ai.generate({
    prompt: [
      {
        text:
          'You are a nutrition coach. Look at this image. If it shows food or drink, ' +
          'estimate the nutrition for a typical portion. If it is NOT food (an object, ' +
          'an animal, a person, a scene, etc.), set isFood=false and calories/macros to 0 ' +
          'and say what it actually is. Do not invent calories for non-food.',
      },
      { media: { url: dataUri } },
    ],
    output: { schema: VerdictSchema },
  });
  if (!output) throw new Error('model returned no structured output');
  return output;
}

function loadManifest(): ManifestEntry[] {
  const p = join(FIXTURES_DIR, 'manifest.json');
  if (!existsSync(p)) return [];
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.warn('[multimodal] manifest.json is not valid JSON — ignoring it.');
    return [];
  }
}

async function run() {
  if (!existsSync(FIXTURES_DIR)) {
    console.log(`\nNo fixtures dir yet. Create evals/fixtures/ and drop in some images, then re-run.\n`);
    return;
  }

  const manifest = loadManifest();
  const manifestByFile = new Map(manifest.map((m) => [m.file, m]));
  const imageFiles = readdirSync(FIXTURES_DIR).filter((f) => IMAGE_EXTS.has(extname(f).toLowerCase()));

  if (imageFiles.length === 0) {
    console.log(
      `\n📷 No images found in evals/fixtures/.\n` +
      `   Drop in some jpg/png files (a real meal + something funny that isn't food),\n` +
      `   optionally label them in evals/fixtures/manifest.json, then re-run.\n`,
    );
    return;
  }

  console.log(`\n🖼️  Multimodal Food/Guardrail Eval — ${imageFiles.length} image(s)\n`);

  let scored = 0, passed = 0;
  const rows: string[] = [];

  await recordReasoningSpan('eval.multimodal_food.suite', { image_count: imageFiles.length }, async () => {
    for (const file of imageFiles) {
      const entry = manifestByFile.get(file);
      const label = entry?.label ?? basename(file);
      const dataUri = toDataUri(join(FIXTURES_DIR, file));

      const result = await recordReasoningSpan(
        'eval.multimodal_food',
        { file, label, expectFood: entry?.expectFood ?? null },
        async () => {
          const verdict = await classifyImage(dataUri);
          // Scored only when the manifest says what to expect.
          const isScored = entry !== undefined;
          const pass = isScored ? verdict.isFood === entry!.expectFood : null;
          return { verdict, isScored, pass };
        },
      );

      const v = result.verdict;
      if (result.isScored) {
        scored++;
        if (result.pass) passed++;
        const mark = result.pass ? '✅' : '❌';
        rows.push(
          `${mark} ${label.padEnd(26)} → isFood=${String(v.isFood).padEnd(5)} ` +
          `(${v.itemName}) ${v.isFood ? `~${v.calories}cal/${v.proteinG}gP` : 'no macros'}`,
        );
      } else {
        // Exploratory — no expected label, just show what it said.
        rows.push(
          `🔎 ${label.padEnd(26)} → isFood=${String(v.isFood).padEnd(5)} ` +
          `(${v.itemName}) ${v.isFood ? `~${v.calories}cal/${v.proteinG}gP` : 'no macros'} — "${v.note}"`,
        );
      }
    }
  });

  console.log(rows.join('\n'));
  if (scored > 0) {
    console.log(`\n── Summary ───────────────────\nGuardrail/verdict accuracy: ${passed}/${scored} (${Math.round((passed / scored) * 100)}%)\n`);
  } else {
    console.log(`\n(No manifest labels — ran ${imageFiles.length} image(s) exploratory. Add manifest.json to score pass/fail.)\n`);
  }

  await flushPhoenixTraces();
  if (process.env.PHOENIX_ENABLED === 'true') {
    console.log(`📊 Traces sent to Phoenix project "${process.env.PHOENIX_PROJECT_NAME ?? 'cfo-fitness'}".\n`);
  }
}

run().catch((err) => {
  console.error('Eval failed:', err);
  process.exit(1);
});

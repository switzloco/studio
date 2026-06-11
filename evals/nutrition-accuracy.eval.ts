/**
 * Nutrition Accuracy Eval — CFO Fitness × Arize Phoenix
 * ----------------------------------------------------
 * Measures how accurately the agent estimates calories + macros for a meal,
 * versus a hand-curated ground-truth dataset. Every case is recorded as a
 * Phoenix span (`eval.nutrition_accuracy`) with the expected vs. predicted
 * values and a pass/fail, so the whole eval is visible in your Phoenix project
 * next to the live agent traces — the "enterprise guardrails" view for judges.
 *
 * Run it:
 *   PHOENIX_ENABLED=true \
 *   PHOENIX_COLLECTOR_ENDPOINT=https://app.phoenix.arize.com/s/nicholas-switzer \
 *   PHOENIX_API_KEY=... \
 *   PHOENIX_PROJECT_NAME=cfo-fitness-evals \
 *   GOOGLE_GENAI_API_KEY=... \
 *   npx tsx evals/nutrition-accuracy.eval.ts
 *
 * (You can also run it without Phoenix — it just prints the local report.)
 *
 * Tip: point PHOENIX_PROJECT_NAME at a separate project (e.g. cfo-fitness-evals)
 * so eval runs don't mix with live user traces.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config();

import { ai } from '@/ai/genkit';
import { flushPhoenixTraces } from '@/ai/observability/phoenix';
import { recordReasoningSpan } from '@/ai/observability/span';
import { z } from 'genkit';

/** Ground-truth macro references (per the stated portion). Edit freely. */
interface EvalCase {
  meal: string;
  expected: { calories: number; proteinG: number; carbsG: number; fatG: number };
}

const DATASET: EvalCase[] = [
  { meal: '5 oz grilled skinless chicken breast', expected: { calories: 250, proteinG: 47, carbsG: 0, fatG: 6 } },
  { meal: '2 slices of sourdough bread',           expected: { calories: 190, proteinG: 8,  carbsG: 37, fatG: 1.5 } },
  { meal: '1 medium apple',                         expected: { calories: 95,  proteinG: 0.5, carbsG: 25, fatG: 0.3 } },
  { meal: '2 large scrambled eggs',                 expected: { calories: 180, proteinG: 12, carbsG: 2,  fatG: 13 } },
  { meal: '1 cup cooked white rice',                expected: { calories: 205, proteinG: 4.3, carbsG: 45, fatG: 0.4 } },
  { meal: '1 scoop (30g) whey protein powder',      expected: { calories: 120, proteinG: 24, carbsG: 3,  fatG: 1.5 } },
  { meal: '6 oz grilled salmon fillet',             expected: { calories: 350, proteinG: 39, carbsG: 0,  fatG: 20 } },
  { meal: '1 medium banana',                        expected: { calories: 105, proteinG: 1.3, carbsG: 27, fatG: 0.4 } },
  { meal: '1 cup whole milk',                       expected: { calories: 150, proteinG: 8,  carbsG: 12, fatG: 8 } },
  { meal: '1 tablespoon olive oil',                 expected: { calories: 119, proteinG: 0,  carbsG: 0,  fatG: 14 } },

  // --- Edge / "gotcha" cases: near-zero items the model must NOT inflate ---
  { meal: 'a tall glass of water',                  expected: { calories: 0,   proteinG: 0,  carbsG: 0,  fatG: 0 } },
  { meal: 'a cup of black coffee, no sugar',        expected: { calories: 2,   proteinG: 0,  carbsG: 0,  fatG: 0 } },
  { meal: 'a stick of sugar-free gum',              expected: { calories: 3,   proteinG: 0,  carbsG: 1,  fatG: 0 } },
];

/** A macro passes if within the tolerance band (relative, with a small abs floor). */
const TOLERANCE_PCT = 0.30;       // 30% — nutrition estimation is inherently fuzzy
const ABS_FLOOR = 3;              // grams/cal slack so near-zero macros don't false-fail

function withinTolerance(expected: number, predicted: number): boolean {
  const band = Math.max(expected * TOLERANCE_PCT, ABS_FLOOR);
  return Math.abs(predicted - expected) <= band;
}

function pctError(expected: number, predicted: number): number {
  if (expected === 0) return predicted === 0 ? 0 : 100;
  return Math.round((Math.abs(predicted - expected) / expected) * 1000) / 10;
}

const MacroSchema = z.object({
  calories: z.number(),
  proteinG: z.number(),
  carbsG: z.number(),
  fatG: z.number(),
});

async function estimateMacros(meal: string) {
  const { output } = await ai.generate({
    prompt:
      `Estimate the nutrition for this exact portion. Use standard USDA reference ` +
      `values. Return ONLY the numbers for the stated portion (not per 100g).\n\nMeal: ${meal}`,
    output: { schema: MacroSchema },
  });
  if (!output) throw new Error('model returned no structured output');
  return output;
}

async function run() {
  // eslint-disable-next-line no-console
  console.log(`\n🧪 Nutrition Accuracy Eval — ${DATASET.length} cases (±${TOLERANCE_PCT * 100}% tolerance)\n`);

  let calPass = 0, proPass = 0, allPass = 0;
  let calErrSum = 0, proErrSum = 0;
  const rows: string[] = [];

  await recordReasoningSpan('eval.nutrition_accuracy.suite', { dataset_size: DATASET.length, tolerance_pct: TOLERANCE_PCT }, async () => {
    for (const c of DATASET) {
      const result = await recordReasoningSpan('eval.nutrition_accuracy', { meal: c.meal, expected: c.expected }, async () => {
        const predicted = await estimateMacros(c.meal);
        const calOk = withinTolerance(c.expected.calories, predicted.calories);
        const proOk = withinTolerance(c.expected.proteinG, predicted.proteinG);
        const calErr = pctError(c.expected.calories, predicted.calories);
        const proErr = pctError(c.expected.proteinG, predicted.proteinG);
        return {
          predicted,
          passed: calOk && proOk,
          caloriesPass: calOk,
          proteinPass: proOk,
          calorieErrorPct: calErr,
          proteinErrorPct: proErr,
        };
      });

      if (result.caloriesPass) calPass++;
      if (result.proteinPass) proPass++;
      if (result.passed) allPass++;
      calErrSum += result.calorieErrorPct;
      proErrSum += result.proteinErrorPct;

      const mark = result.passed ? '✅' : '❌';
      rows.push(
        `${mark} ${c.meal.padEnd(38)} cal ${String(result.predicted.calories).padStart(4)} (exp ${c.expected.calories}, ${result.calorieErrorPct}% off) | ` +
        `protein ${String(result.predicted.proteinG).padStart(4)}g (exp ${c.expected.proteinG}g, ${result.proteinErrorPct}% off)`,
      );
    }
  });

  const n = DATASET.length;
  // eslint-disable-next-line no-console
  console.log(rows.join('\n'));
  // eslint-disable-next-line no-console
  console.log(
    `\n── Summary ────────────────────────────────────────\n` +
    `Overall pass (cal+protein both in band): ${allPass}/${n} (${Math.round((allPass / n) * 100)}%)\n` +
    `Calorie accuracy:  ${calPass}/${n} pass · mean abs error ${Math.round((calErrSum / n) * 10) / 10}%\n` +
    `Protein accuracy:  ${proPass}/${n} pass · mean abs error ${Math.round((proErrSum / n) * 10) / 10}%\n`,
  );

  await flushPhoenixTraces();
  if (process.env.PHOENIX_ENABLED === 'true') {
    // eslint-disable-next-line no-console
    console.log(`📊 Traces sent to Phoenix project "${process.env.PHOENIX_PROJECT_NAME ?? 'cfo-fitness'}" — open it to see per-case spans.\n`);
  }
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Eval failed:', err);
  process.exit(1);
});

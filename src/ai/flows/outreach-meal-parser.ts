/**
 * @fileOverview Cost-optimized meal parser for Email & Discord outreach replies.
 *
 * Uses `CFO_LITE_MODEL` (~$0.00015 per call) + `nutritionLookupTool` (USDA) so
 * free outreach users can reply in plain English ("3 eggs and sourdough toast"
 * or "Chipotle double chicken bowl no rice") without triggering the full 13-tool
 * coaching prompt.
 */

import { ai, CFO_LITE_MODEL, CFO_MODEL } from '@/ai/genkit';
import { z } from 'genkit';
import { nutritionLookupTool } from '@/ai/tools/nutrition-lookup';
import { trackAiUsage } from '@/lib/ai-usage';
import { inferMealFromTime } from '@/lib/food-exercise-types';

export const ParsedOutreachMealSchema = z.object({
  isFoodLog: z
    .boolean()
    .describe('True if the text describes food, drink, alcohol, or supplements consumed; false if unrelated or empty.'),
  isStopCommand: z
    .boolean()
    .describe('True if the user is asking to stop, cancel, pause, or unsubscribe from messages.'),
  name: z
    .string()
    .describe('Concise combined meal label, e.g. "3 Eggs + Sourdough Toast" or "Chipotle Double Chicken Bowl".'),
  portionG: z.number().describe('Total estimated portion weight in grams.'),
  calories: z.number().describe('Total calories (kcal).'),
  proteinG: z.number().describe('Total protein in grams.'),
  carbsG: z.number().describe('Total carbohydrates in grams.'),
  fatG: z.number().describe('Total fat in grams.'),
  fiberG: z.number().optional().describe('Dietary fiber in grams.'),
  plantMassG: z.number().optional().describe('Raw fruit + vegetable grams (Starrett 800g protocol).'),
  alcoholDrinks: z.number().optional().describe('Standard alcoholic drinks included (0 if none).'),
  hasSeedOils: z.boolean().optional().describe('True if deep-fried or heavy restaurant seed oils.'),
  consumedAt: z
    .string()
    .optional()
    .describe('24-hour HH:MM if the user stated when they ate (e.g. "at 1pm" -> "13:00"); omit otherwise.'),
  meal: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
  source: z.enum(['usda', 'user_estimate']),
});

export type ParsedOutreachMeal = z.infer<typeof ParsedOutreachMealSchema>;

/**
 * Strips quoted email threads ("On Nov 11, 2026 ... wrote:", "> " lines, signatures)
 * so only the user's fresh reply text is evaluated.
 */
export function extractCleanReplyText(rawText: string): string {
  if (!rawText) return '';
  // Normalize CRLF + narrow/non-breaking spaces inserted by Gmail/iOS Mail
  const normalized = rawText
    .replace(/\r\n/g, '\n')
    .replace(/[\u00a0\u202f]/g, ' ')
    // Strip multi-line wrapped "On Thu, Nov 12, 2026 at 7:12 PM ... \nwrote:" blocks
    .replace(/\nOn [\s\S]{10,260}?wrote:\s*\n[\s\S]*$/i, '');

  const lines = normalized.split('\n');
  const kept: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^On .+wrote:$/i.test(trimmed)) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(trimmed)) break;
    if (/^From:\s+.+@/i.test(trimmed)) break;
    if (/^Sent from my (iPhone|Android|Galaxy|Pixel)/i.test(trimmed)) break;
    if (trimmed === '--') break;
    if (trimmed.startsWith('>')) continue;
    kept.push(line);
  }

  return kept.join('\n').trim().slice(0, 800);
}

/**
 * Deterministic check for stop/unsubscribe replies before spending any LLM tokens.
 */
export function isExplicitStopKeyword(cleanText: string): boolean {
  const lower = cleanText.trim().toLowerCase();
  return /^(stop|unsubscribe|cancel|quit|end|off|pause)\b[.!]*$/i.test(lower);
}

const OUTREACH_MEAL_SYSTEM = `You are the CFO's Nutrition Intake Clerk. Convert a short meal reply from Email or Discord into a single summed macro entry.

RULES:
1. If the user asks to unsubscribe, stop, or cancel messages, set isStopCommand=true and isFoodLog=false.
2. Respect exact fractions, weights, and restaurant/branded specs (e.g. "1/4 costco hot dog" = 0.25x a full 570 kcal / 24g P Costco beef hot dog & bun; "3 oz costco pepperoni pizza" = 85g portion ~220 kcal / 11.5g P, NOT a full 8.9 oz food-court slice; "1 nurri shake" = Nurri 11 fl oz ultra-filtered milk shake = 150 kcal, 30g P, 3g C, 2.5g F). Compute standard whole foods, major restaurant items, and known shakes directly without tool calls; only call nutrition_lookup when an item is genuinely unfamiliar.
3. Sum all items mentioned in the message into ONE combined entry with a clear, concise name listing each item (e.g. "1/4 Costco Hot Dog + 3 oz Pepperoni Pizza + Nurri Shake").
4. Keep portionG, calories, proteinG, carbsG, and fatG realistic and internally consistent (4*P + 4*C + 9*F + 7*alcohol_g ≈ calories).`;

export async function parseOutreachMealText(params: {
  uid: string;
  rawText: string;
  localTime: string;
}): Promise<ParsedOutreachMeal> {
  const cleanText = extractCleanReplyText(params.rawText);
  if (!cleanText) {
    return {
      isFoodLog: false,
      isStopCommand: false,
      name: '',
      portionG: 0,
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      source: 'user_estimate',
    };
  }

  if (isExplicitStopKeyword(cleanText)) {
    return {
      isFoodLog: false,
      isStopCommand: true,
      name: '',
      portionG: 0,
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      source: 'user_estimate',
    };
  }

  const prompt = `Local time: ${params.localTime}\nUser message: "${cleanText}"`;
  const genOptions = {
    system: OUTREACH_MEAL_SYSTEM,
    prompt,
    tools: [nutritionLookupTool],
    output: { schema: ParsedOutreachMealSchema },
    config: { temperature: 0.1 },
  };

  let result;
  try {
    result = await ai.generate({
      ...genOptions,
      model: CFO_LITE_MODEL,
      use: [trackAiUsage({ uid: params.uid, feature: 'outreach_meal_parse', model: CFO_LITE_MODEL })],
    });
  } catch (err: any) {
    console.warn(`[OutreachMealParser] ${CFO_LITE_MODEL} failed, falling back to ${CFO_MODEL}:`, err?.message ?? String(err));
    result = await ai.generate({
      ...genOptions,
      model: CFO_MODEL,
      use: [trackAiUsage({ uid: params.uid, feature: 'outreach_meal_parse', model: CFO_MODEL })],
    });
  }

  const output = result.output;
  if (!output) {
    throw new Error('Could not parse meal text.');
  }

  const resolvedTime = output.consumedAt || params.localTime;
  return {
    ...output,
    consumedAt: resolvedTime,
    meal: output.meal ?? inferMealFromTime(resolvedTime),
  };
}

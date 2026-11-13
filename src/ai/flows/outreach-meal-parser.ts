/**
 * @fileOverview Cost-optimized 1-pass meal & photo parser + direct reply note
 * for Email & Discord outreach replies.
 *
 * Uses a single `CFO_LITE_MODEL` (`vertexai/gemini-3.1-flash-lite`) call (~$0.00010 text,
 * ~$0.00018 with photo) with zero tool-loop round-trips so inbound replies stay ~100x
 * cheaper than full multi-turn chat while accepting both plain English and attached photos.
 */

import { ai, CFO_LITE_MODEL, CFO_MODEL } from '@/ai/genkit';
import { z } from 'genkit';
import { trackAiUsage } from '@/lib/ai-usage';
import { inferMealFromTime } from '@/lib/food-exercise-types';

export const ParsedOutreachMealItemSchema = z.object({
  name: z
    .string()
    .describe('Concise meal label for this specific day/meal window, e.g. "Beef Stick + 3 oz Corn Dippers + 1.5 Bottles Red Wine" or "McDonald\'s Egg Sausage McMuffin + Small Turkey Stick".'),
  portionG: z.number().describe('Estimated portion weight in grams for this entry.'),
  calories: z.number().describe('Total calories in kcal for this entry.'),
  proteinG: z.number().describe('Total protein in grams for this entry.'),
  carbsG: z.number().describe('Total carbohydrates in grams for this entry.'),
  fatG: z.number().describe('Total fat in grams for this entry.'),
  fiberG: z.number().optional().describe('Dietary fiber in grams.'),
  plantMassG: z.number().optional().describe('Raw fruit + vegetable grams (Starrett 800g protocol).'),
  alcoholDrinks: z.number().optional().describe('Standard alcoholic drinks included in this entry (0 if none).'),
  hasSeedOils: z.boolean().optional().describe('True if deep-fried or heavy restaurant seed oils.'),
  dayOffset: z
    .number()
    .optional()
    .describe('0 for today (default), -1 for yesterday / "last night". Never combine yesterday/last-night items with today/this-morning items in the same entry.'),
  consumedAt: z
    .string()
    .optional()
    .describe('24-hour HH:MM when eaten (e.g. "at 1pm" -> "13:00", "last night" -> "20:30", "this morning" -> "08:30"); omit if eaten right now.'),
  meal: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
  source: z.enum(['usda', 'user_estimate']).optional(),
});

export type ParsedOutreachMealItem = z.infer<typeof ParsedOutreachMealItemSchema>;

export const ParsedOutreachMealSchema = z.object({
  isFoodLog: z
    .boolean()
    .describe('True if the message or attached photo shows new food, drink, alcohol, or supplements to log; false if unrelated, already logged, or a pure question.'),
  isStopCommand: z
    .boolean()
    .describe('True if the user is asking to stop, cancel, pause, opt out, or says "don\'t message me".'),
  scheduleMorningHour: z
    .number()
    .optional()
    .describe('If the user asks to change their morning briefing time, the new 24-hour integer (5–11).'),
  scheduleMiddayHour: z
    .number()
    .optional()
    .describe('If the user asks to change their midday briefing time, the new 24-hour integer (11–16).'),
  scheduleNightHour: z
    .number()
    .optional()
    .describe('If the user asks to change their evening/night briefing time, the new 24-hour integer (17–22).'),
  scheduleCadence: z
    .enum(['3x', 'morning_only'])
    .optional()
    .describe('If the user asks to switch to 1x/day morning-only ("morning_only") or 3x/day ("3x").'),
  scheduleTimezone: z
    .string()
    .optional()
    .describe('If the user asks to change their timezone (e.g. Eastern -> America/New_York, Central -> America/Chicago, Mountain -> America/Denver, Pacific -> America/Los_Angeles), the IANA timezone.'),
  removeFoodId: z
    .string()
    .optional()
    .describe('If the user asks to delete/remove a specific meal from Today\'s or Yesterday\'s Ledger, set this to that meal\'s exact id from the provided ledger list.'),
  name: z
    .string()
    .describe('Concise meal label (or summary of logged entries). Empty string if isFoodLog=false.'),
  portionG: z.number().describe('Total estimated portion weight in grams (0 if isFoodLog=false).'),
  calories: z.number().describe('Total calories in kcal (0 if isFoodLog=false).'),
  proteinG: z.number().describe('Total protein in grams (0 if isFoodLog=false).'),
  carbsG: z.number().describe('Total carbohydrates in grams (0 if isFoodLog=false).'),
  fatG: z.number().describe('Total fat in grams (0 if isFoodLog=false).'),
  fiberG: z.number().optional().describe('Dietary fiber in grams.'),
  plantMassG: z.number().optional().describe('Raw fruit + vegetable grams (Starrett 800g protocol).'),
  alcoholDrinks: z.number().optional().describe('Standard alcoholic drinks included (0 if none).'),
  hasSeedOils: z.boolean().optional().describe('True if deep-fried or heavy restaurant seed oils.'),
  dayOffset: z
    .number()
    .optional()
    .describe('0 for today (default), -1 for yesterday / "last night".'),
  consumedAt: z
    .string()
    .optional()
    .describe('24-hour HH:MM if the user stated when they ate (e.g. "at 1pm" -> "13:00", "last night" -> "20:30"); omit otherwise.'),
  meal: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
  source: z.enum(['usda', 'user_estimate']),
  entries: z
    .array(ParsedOutreachMealItemSchema)
    .optional()
    .describe('One entry per distinct day or meal window. Whenever the user reports food from MULTIPLE windows or days (e.g. "Last night I ate X ... This morning I had Y"), you MUST return separate entries here (one with dayOffset=-1 for last night/yesterday, and one with dayOffset=0 for this morning/today) instead of combining them.'),
  agentReply: z
    .string()
    .describe('Direct, sharp 1-sentence CFO reply acknowledging what was logged (including which day if split across yesterday & today, or briefly answering their question if isFoodLog=false). No markdown headers, no fluff.'),
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
  if (/^(stop|unsubscribe|cancel|quit|end|off|pause|opt\s*out|remove\s*me)\b[.!]*$/i.test(lower)) {
    return true;
  }
  return /\b(don'?t|do\s+not|stop)\s+(message|dm|ping|email|text|contact)(?:ing)?\s+me\b/i.test(
    lower,
  );
}

const OUTREACH_MEAL_SYSTEM = `You are "the CFO" — a direct, numbers-first Chief Fitness Officer replying to a client's quick email or Discord update.
Parse their meal text and/or attached meal or nutrition-label photo(s) into structured macro entry/entries, plus a sharp 1-sentence agentReply.

RULES:
1. If the user asks to unsubscribe, stop, cancel messages, or says "don't message me", set isStopCommand=true, isFoodLog=false, and agentReply="Done — your automated briefings are canceled."
2. If the user asks to customize their briefing schedule (e.g. "message me at 8am, 1pm, and 8pm", "only ping me in the morning", "I'm on Eastern time"), populate scheduleMorningHour / scheduleMiddayHour / scheduleNightHour / scheduleCadence / scheduleTimezone accordingly and confirm the new schedule in agentReply.
3. MULTI-DAY & MULTI-MEAL SPLITTING (CRITICAL):
   - NEVER combine food from "last night" / "yesterday" with food from "this morning" / "today" into a single entry!
   - Whenever the user reports food across multiple days or distinct meal windows (e.g. "Last night I ate 1 beef stick, 3 oz corn dippers, 1.5 bottles red wine ... This morning - 1 McDonald's egg sausage muffin plus a small turkey stick"), populate the \`entries\` array with ONE SEPARATE entry per day/window:
     • For "last night" / "yesterday" items: set \`dayOffset: -1\`, \`meal: "dinner"\` (or appropriate meal), and \`consumedAt: "20:30"\` (or the stated time).
     • For "this morning" / "today" items: set \`dayOffset: 0\`, \`meal: "breakfast"\` (or appropriate meal), and \`consumedAt: "08:30"\` (or stated time / current localTime).
   - Even if the user only reports food from "last night" / "yesterday" (with nothing from today), set \`dayOffset: -1\` and \`consumedAt: "20:30"\` (unless a specific time was given) so it lands on yesterday's ledger instead of this morning!
4. DUPLICATE CHECKING:
   - Before logging, check \`Today's Active Ledger\` and \`Yesterday's Active Ledger\` provided in the prompt.
   - If the user asks to "double-check I didn't already enter those" or mentions an item already recorded on that day's ledger, do NOT re-log the already-recorded item — only log the genuinely missing item(s) (or set isFoodLog=false if everything is already on the ledger) and explicitly confirm in agentReply what was already on the books vs. newly logged.
5. If photos are attached for a single meal, read nutrition labels or estimate plate portions visually with high precision.
6. Respect exact fractions, weights, and restaurant/branded specs (e.g. "1/4 costco hot dog" = 0.25x a full 570 kcal / 24g P Costco beef hot dog & bun; "3 oz costco pepperoni pizza" = 85g portion ~220 kcal / 11.5g P, NOT a full 8.9 oz slice; "1 nurri shake" = Nurri 11 fl oz ultra-filtered milk shake = 150 kcal, 30g P, 3g C, 2.5g F).
7. Keep portionG, calories, proteinG, carbsG, and fatG realistic and internally consistent (4*P + 4*C + 9*F + 7*alcohol_g ≈ calories).
8. If the user asks a question about their ledger, dupes, macros, or what to eat next without logging new food, set isFoodLog=false and answer directly in agentReply using the provided Today's & Yesterday's Ledger context. If they ask to delete/remove a logged entry, set removeFoodId to its exact id and confirm in agentReply.`;

export interface OutreachImageAttachment {
  dataUri: string;
  contentType: string;
}

export interface OutreachLedgerContextItem {
  id?: string;
  name: string;
  calories: number;
  proteinG: number;
  plantMassG?: number;
  consumedAt?: string;
  date?: string;
}

export function resolveEntryConsumedAt(params: {
  dayOffset: number;
  meal?: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  explicitConsumedAt?: string;
  localTime: string;
}): string {
  const cleanExplicit = params.explicitConsumedAt?.trim();
  if (cleanExplicit && /^\d{1,2}:\d{2}$/.test(cleanExplicit)) {
    const [h, m] = cleanExplicit.split(':');
    const formatted = `${String(Number(h)).padStart(2, '0')}:${m}`;
    // Guard against the LLM copying a morning localTime onto a "last night" dinner entry
    if (params.dayOffset < 0 && formatted === params.localTime && Number(h) < 15 && params.meal !== 'breakfast' && params.meal !== 'lunch') {
      return '20:30';
    }
    return formatted;
  }
  if (params.dayOffset < 0) {
    if (params.meal === 'breakfast') return '08:30';
    if (params.meal === 'lunch') return '12:30';
    return '20:30';
  }
  return params.localTime;
}

export async function parseOutreachMealText(params: {
  uid: string;
  rawText: string;
  localTime: string;
  photoDataUris?: OutreachImageAttachment[];
  todayFoods?: OutreachLedgerContextItem[];
  yesterdayFoods?: OutreachLedgerContextItem[];
  proteinGoal?: number;
  clientDisplayName?: string;
}): Promise<ParsedOutreachMeal> {
  const cleanText = extractCleanReplyText(params.rawText);
  const photos = (params.photoDataUris ?? []).slice(0, 3);
  const hasPhotos = photos.length > 0;

  if (!cleanText && !hasPhotos) {
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
      agentReply: 'Tell me what you had (or attach a quick pic of your meal or label) and I will put it on the books.',
    };
  }

  if (!hasPhotos && isExplicitStopKeyword(cleanText)) {
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
      agentReply: 'Done — your automated briefings are canceled.',
    };
  }

  const todayLines = (params.todayFoods ?? []).map(
    (f, idx) =>
      `#${idx + 1} [id=${f.id || 'none'}] ${f.consumedAt || ''} ${f.name} (${f.calories} kcal, ${f.proteinG}g P${f.plantMassG ? `, ${f.plantMassG}g plants` : ''})`,
  );
  const totalKcal = (params.todayFoods ?? []).reduce((s, f) => s + (f.calories || 0), 0);
  const totalP = (params.todayFoods ?? []).reduce((s, f) => s + (f.proteinG || 0), 0);
  const todayLedgerContext =
    todayLines.length > 0
      ? `Today's Active Ledger (${todayLines.length} entry/entries, total ${totalKcal} kcal, ${totalP}g / ${params.proteinGoal ?? 150}g protein):\n${todayLines.join('\n')}`
      : `Today's Active Ledger: 0 entries logged today (0 kcal, 0g / ${params.proteinGoal ?? 150}g protein).`;

  const yesterdayLines = (params.yesterdayFoods ?? []).map(
    (f, idx) =>
      `#${idx + 1} [id=${f.id || 'none'}] ${f.consumedAt || ''} ${f.name} (${f.calories} kcal, ${f.proteinG}g P)`,
  );
  const yTotalKcal = (params.yesterdayFoods ?? []).reduce((s, f) => s + (f.calories || 0), 0);
  const yTotalP = (params.yesterdayFoods ?? []).reduce((s, f) => s + (f.proteinG || 0), 0);
  const yesterdayLedgerContext =
    yesterdayLines.length > 0
      ? `Yesterday's Active Ledger (${yesterdayLines.length} entry/entries, total ${yTotalKcal} kcal, ${yTotalP}g protein):\n${yesterdayLines.join('\n')}`
      : `Yesterday's Active Ledger: 0 entries logged yesterday.`;

  const clientNameLine = params.clientDisplayName?.trim()
    ? `Client name/title: ${params.clientDisplayName.trim()} (address them respectfully by their title/name when natural)\n`
    : '';
  const ledgerContext = `${clientNameLine}${todayLedgerContext}\n${yesterdayLedgerContext}`;

  const textPrompt = cleanText
    ? `Local time: ${params.localTime}\n${ledgerContext}\nClient message: "${cleanText}"`
    : `Local time: ${params.localTime}\n${ledgerContext}\nClient attached ${photos.length} meal/nutrition-label photo(s) with no text — identify and log what is shown.`;

  const promptParts = hasPhotos
    ? [
        ...photos.map((p) => ({ media: { url: p.dataUri, contentType: p.contentType } })),
        { text: textPrompt },
      ]
    : textPrompt;

  const genOptions = {
    system: OUTREACH_MEAL_SYSTEM,
    prompt: promptParts,
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

  const rawEntries = (output.entries ?? []).filter((e) => e && e.name && e.name.trim().length > 0);
  const normalizedEntries: ParsedOutreachMealItem[] =
    rawEntries.length > 0
      ? rawEntries.map((entry) => {
          const dayOffset = entry.dayOffset && entry.dayOffset < 0 ? -1 : 0;
          const resolvedTime = resolveEntryConsumedAt({
            dayOffset,
            meal: entry.meal,
            explicitConsumedAt: entry.consumedAt,
            localTime: params.localTime,
          });
          return {
            ...entry,
            name: entry.name.trim(),
            dayOffset,
            consumedAt: resolvedTime,
            meal: entry.meal ?? inferMealFromTime(resolvedTime),
            source: entry.source ?? output.source ?? 'user_estimate',
          };
        })
      : output.isFoodLog && output.name?.trim()
        ? [
            (() => {
              const dayOffset = output.dayOffset && output.dayOffset < 0 ? -1 : 0;
              const resolvedTime = resolveEntryConsumedAt({
                dayOffset,
                meal: output.meal,
                explicitConsumedAt: output.consumedAt,
                localTime: params.localTime,
              });
              return {
                name: output.name.trim(),
                portionG: output.portionG,
                calories: output.calories,
                proteinG: output.proteinG,
                carbsG: output.carbsG,
                fatG: output.fatG,
                fiberG: output.fiberG,
                plantMassG: output.plantMassG,
                alcoholDrinks: output.alcoholDrinks,
                hasSeedOils: output.hasSeedOils,
                dayOffset,
                consumedAt: resolvedTime,
                meal: output.meal ?? inferMealFromTime(resolvedTime),
                source: output.source ?? 'user_estimate',
              };
            })(),
          ]
        : [];

  const primary = normalizedEntries[0];
  const resolvedPrimaryTime =
    primary?.consumedAt ||
    resolveEntryConsumedAt({
      dayOffset: output.dayOffset && output.dayOffset < 0 ? -1 : 0,
      meal: output.meal,
      explicitConsumedAt: output.consumedAt,
      localTime: params.localTime,
    });

  return {
    ...output,
    isFoodLog: output.isFoodLog && normalizedEntries.length > 0,
    name:
      normalizedEntries.length > 1
        ? normalizedEntries.map((e) => e.name).join(' · ')
        : primary?.name || output.name || '',
    portionG:
      normalizedEntries.length > 0
        ? normalizedEntries.reduce((s, e) => s + (e.portionG || 0), 0)
        : output.portionG,
    calories:
      normalizedEntries.length > 0
        ? normalizedEntries.reduce((s, e) => s + (e.calories || 0), 0)
        : output.calories,
    proteinG:
      normalizedEntries.length > 0
        ? normalizedEntries.reduce((s, e) => s + (e.proteinG || 0), 0)
        : output.proteinG,
    carbsG:
      normalizedEntries.length > 0
        ? normalizedEntries.reduce((s, e) => s + (e.carbsG || 0), 0)
        : output.carbsG,
    fatG:
      normalizedEntries.length > 0
        ? normalizedEntries.reduce((s, e) => s + (e.fatG || 0), 0)
        : output.fatG,
    dayOffset: primary?.dayOffset ?? (output.dayOffset && output.dayOffset < 0 ? -1 : 0),
    consumedAt: resolvedPrimaryTime,
    meal: primary?.meal ?? output.meal ?? inferMealFromTime(resolvedPrimaryTime),
    entries: normalizedEntries,
  };
}

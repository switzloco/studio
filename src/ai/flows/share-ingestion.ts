'use server';
/**
 * @fileOverview Genkit flow for "Share Ingestion" — parses raw shared text
 * (basketball stats, workout notes, Fitbit summaries, etc.) into structured
 * Firestore-ready JSON via the Coach LLM.
 *
 * Designed for the Web Share Target API pipeline: OS share → service worker
 * → /incoming-share page → /api/ingest-share → this flow → Firestore.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { getAdminFirestore } from '@/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';

// ─── Schemas ────────────────────────────────────────────────────────────────

/**
 * Flat, analyst-friendly schema for parsed shared data.
 * Every field is optional because the raw text may only contain partial info.
 * The Analyst agent can query this collection with simple
 * .where('date', '==', ...) or .where('domain', '==', 'performance') filters.
 */
const ParsedShareDataSchema = z.object({
  // ── Classification ──
  domain: z.enum(['performance', 'metabolic', 'mixed', 'unknown'])
    .describe('Primary domain: "performance" for shooting/sport stats, "metabolic" for calories/HR/duration, "mixed" if both present, "unknown" if unparseable.'),
  category: z.string()
    .describe('Freeform sub-category, e.g. "basketball_shooting", "fitbit_daily", "workout_notes", "running", "walking".'),
  summary: z.string()
    .describe('One-sentence human-readable summary of the parsed data.'),

  // ── Performance Metrics (sport/skill) ──
  totalAttempts: z.number().optional()
    .describe('Total attempts/shots/reps explicitly stated in the text.'),
  totalMakes: z.number().optional()
    .describe('Total successful attempts explicitly stated.'),
  totalMisses: z.number().optional()
    .describe('Total misses explicitly stated. If only makes and attempts are given, compute: attempts - makes.'),
  shootingPct: z.number().optional()
    .describe('Shooting/success percentage (0-100). Compute from makes/attempts if not stated.'),
  minShootingPct: z.number().optional()
    .describe('Minimum shooting percentage across drills, if multiple drills are reported.'),
  maxShootingPct: z.number().optional()
    .describe('Maximum shooting percentage across drills, if multiple drills are reported.'),
  drillBreakdown: z.array(z.object({
    drillName: z.string(),
    attempts: z.number().optional(),
    makes: z.number().optional(),
    pct: z.number().optional(),
  })).optional()
    .describe('Per-drill breakdown if the text reports multiple drills or stations.'),

  // ── Metabolic Data ──
  caloriesBurned: z.number().optional()
    .describe('Total calories burned, explicitly stated.'),
  durationMin: z.number().optional()
    .describe('Duration in minutes.'),
  avgHeartRate: z.number().optional()
    .describe('Average heart rate in bpm.'),
  maxHeartRate: z.number().optional()
    .describe('Max heart rate in bpm.'),
  steps: z.number().optional()
    .describe('Step count if reported.'),
  distanceKm: z.number().optional()
    .describe('Distance in km if reported (convert from miles if needed).'),
  activeMinutes: z.number().optional()
    .describe('Active zone minutes or equivalent.'),

  // ── Context ──
  activityName: z.string().optional()
    .describe('Name of the activity: "Basketball Shooting", "Morning Run", etc.'),
  notes: z.string().optional()
    .describe('Any freeform notes, observations, or context from the text that doesn\'t fit the structured fields.'),

  // ── Raw ──
  rawText: z.string()
    .describe('The original unmodified shared text, preserved for audit trail.'),
});

export type ParsedShareData = z.infer<typeof ParsedShareDataSchema>;

const ShareIngestionInputSchema = z.object({
  userId: z.string(),
  rawText: z.string().describe('The raw shared text from the OS share sheet.'),
  sourceTitle: z.string().optional().describe('The title field from the share intent, e.g. app name.'),
  sourceUrl: z.string().optional().describe('The URL field from the share intent, if any.'),
  localDate: z.string().describe('YYYY-MM-DD from the client.'),
  localTime: z.string().describe('HH:MM from the client.'),
});

export type ShareIngestionInput = z.infer<typeof ShareIngestionInputSchema>;

const ShareIngestionOutputSchema = z.object({
  success: z.boolean(),
  documentId: z.string().optional(),
  parsed: ParsedShareDataSchema.optional(),
  error: z.string().optional(),
});

export type ShareIngestionOutput = z.infer<typeof ShareIngestionOutputSchema>;

// ─── System Prompt for the Coach Parser ─────────────────────────────────────

const SHARE_PARSER_SYSTEM = `You are the CFO's Data Intake Clerk — a precise, no-nonsense parser that converts raw unstructured text into clean JSON.

CRITICAL RULES:
1. **NEVER GUESS.** Only extract values that are EXPLICITLY stated or directly computable from stated values (e.g., misses = attempts - makes).
2. **Strictly separate domains:**
   - "performance" = sport/skill metrics: shooting %, attempts, makes, misses, drill breakdowns
   - "metabolic" = body/energy metrics: calories burned, heart rate, duration, steps, distance
   - "mixed" = text contains BOTH performance AND metabolic data
   - "unknown" = text is not fitness/health related or is unparseable
3. **Shooting string format:** Basketball shooting strings like "MMMXMXMMM" use M=make, X=miss. Count them precisely.
4. **Unit conversions:** Convert miles to km (×1.609), Fahrenheit to Celsius if needed. Always store duration in minutes.
5. **Drill breakdown:** If the text reports multiple drills/stations (e.g., "3-pointers: 7/10, free throws: 9/10"), create a drillBreakdown array.
6. **Fitbit/wearable summaries:** Extract calories, steps, active minutes, heart rate zones, distance. Category = "fitbit_daily" or "fitbit_exercise".
7. **Return ONLY the JSON object matching the schema. No prose, no markdown, no code fences.**

Examples of raw text you might receive:
- "Basketball: MMMXMXMMM XXMMMMM - 45 min, 312 cal burned"
- "Fitbit Daily: 8,234 steps, 2,187 cal burned, 47 active zone min, resting HR 62"
- "3pt shooting: 7/10 from top, 5/10 from corner, 8/10 FT. Total: 20/30 (66.7%)"
- "Morning run: 3.2 mi in 28:15, avg HR 155, max HR 172, 340 cal"
- "Quick note: felt strong today, legs recovered from Thursday squat session"`;

// ─── The Genkit Flow ────────────────────────────────────────────────────────

export const shareIngestionFlow = ai.defineFlow(
  {
    name: 'shareIngestionFlow',
    inputSchema: ShareIngestionInputSchema,
    outputSchema: ShareIngestionOutputSchema,
  },
  async (input) => {
    try {
      // Combine all share fields into a single text block for the LLM
      const combinedText = [
        input.sourceTitle ? `[Source: ${input.sourceTitle}]` : '',
        input.rawText,
        input.sourceUrl ? `[URL: ${input.sourceUrl}]` : '',
      ].filter(Boolean).join('\n');

      // Ask the Coach LLM to parse the raw text
      const { output } = await ai.generate({
        model: 'googleai/gemini-1.5-flash',
        system: SHARE_PARSER_SYSTEM,
        prompt: combinedText,
        output: { schema: ParsedShareDataSchema },
        config: { temperature: 0.1 },  // Low temp for deterministic parsing
      });

      if (!output) {
        return { success: false, error: 'LLM returned no structured output.' };
      }

      // Ensure rawText is preserved even if the LLM didn't echo it
      const parsed: ParsedShareData = {
        ...output,
        rawText: input.rawText,
      };

      // ── Write to Firestore ──
      const firestore = getAdminFirestore();
      const docData = {
        // Flat fields for easy Analyst queries
        ...parsed,
        // Timestamps & metadata
        userId: input.userId,
        date: input.localDate,                        // YYYY-MM-DD for date-range queries
        time: input.localTime,                        // HH:MM for intra-day ordering
        timestamp: FieldValue.serverTimestamp(),       // Server timestamp for ordering
        sourceTitle: input.sourceTitle || null,
        sourceUrl: input.sourceUrl || null,
        // Ingestion metadata
        ingestedVia: 'share_target',
        ingestedAt: new Date().toISOString(),
      };

      const docRef = await firestore
        .collection(`users/${input.userId}/shared_data`)
        .add(docData);

      return {
        success: true,
        documentId: docRef.id,
        parsed,
      };
    } catch (error: any) {
      console.error('[ShareIngestion] Error:', error?.message ?? String(error));
      return {
        success: false,
        error: error?.message ?? 'Unknown parsing error.',
      };
    }
  }
);

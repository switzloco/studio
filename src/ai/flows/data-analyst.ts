'use server';

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService as healthService } from '@/lib/health-service-admin';
import { addDaysIso, alignSeriesByDate, correlation, MIN_N_FOR_CORRELATION } from '@/lib/correlation';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const calculateStatsTool = ai.defineTool(
  {
    name: 'calculate_statistics',
    description: 'Calculates mean, median, variance, standard deviation, min, max, and sum for an array of numbers. Use this to ensure accurate math when analyzing data.',
    inputSchema: z.object({
      numbers: z.array(z.number()),
    }),
    outputSchema: z.object({
      mean: z.number(),
      variance: z.number(),
      stdDev: z.number(),
      min: z.number(),
      max: z.number(),
      sum: z.number(),
      count: z.number(),
    })
  },
  async (input) => {
    const nums = input.numbers;
    if (nums.length === 0) return { mean: 0, variance: 0, stdDev: 0, min: 0, max: 0, sum: 0, count: 0 };
    const sum = nums.reduce((a, b) => a + b, 0);
    const mean = sum / nums.length;
    const variance = nums.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / nums.length;
    return {
      mean,
      variance,
      stdDev: Math.sqrt(variance),
      min: Math.min(...nums),
      max: Math.max(...nums),
      sum,
      count: nums.length,
    };
  }
);

const fetchHistoricalDataTool = ai.defineTool(
  {
    name: 'fetch_historical_data',
    description: 'Fetches the user\'s exercise, food, fasting, or custom-metric logs over a specified number of days. Returns raw entries with dates so you can filter by day of the week, exercise type, etc. For custom metrics, pass metricKey to filter to one series.',
    inputSchema: z.object({
      userId: z.string(),
      localDate: z.string().regex(ISO_DATE_RE, 'localDate must be YYYY-MM-DD').describe('The current local date YYYY-MM-DD from the client, used as the anchor for "today"'),
      type: z.enum(['food', 'exercise', 'fasting', 'custom']),
      daysBack: z.number().int().min(1).max(180).describe('Number of days to look back. e.g. 30 for a month, 90 for a quarter. Max 180.'),
      metricKey: z.string().optional().describe('For type="custom": filter to a single metric series. Omit to return all custom metrics.'),
    }),
    outputSchema: z.any(),
  },
  async (input) => {
    const firestore = getAdminFirestore();
    const daysBack = Math.min(input.daysBack, 180);
    const endDate = input.localDate;
    const startDate = addDaysIso(endDate, -(daysBack - 1));

    if (input.type === 'exercise') {
      const ref = firestore.collection(`users/${input.userId}/exercise_log`);
      const snapshot = await ref
        .where('date', '>=', startDate)
        .where('date', '<=', endDate)
        .orderBy('date', 'desc')
        .limit(500)
        .get();
      return snapshot.docs
        .map(d => ({ ...d.data(), id: d.id }))
        .filter((e: any) => !e.ignored);
    }

    if (input.type === 'food') {
      const ref = firestore.collection(`users/${input.userId}/food_log`);
      const snapshot = await ref
        .where('date', '>=', startDate)
        .where('date', '<=', endDate)
        .orderBy('date', 'desc')
        .limit(1000)
        .get();
      return snapshot.docs
        .map(d => ({ ...d.data(), id: d.id }))
        .filter((e: any) => !e.ignored);
    }

    if (input.type === 'fasting') {
      return await healthService.queryFastLogRange(
        firestore,
        input.userId,
        startDate,
        endDate,
        200
      );
    }

    if (input.type === 'custom') {
      const { entries, truncated } = await healthService.queryCustomMetricLogRange(
        firestore,
        input.userId,
        startDate,
        endDate,
        { metricKey: input.metricKey, limit: 1000 }
      );
      return { entries, truncated };
    }
  }
);

const alignSeriesByDateTool = ai.defineTool(
  {
    name: 'align_series_by_date',
    description: 'Pairs two date-stamped series into aligned (xs, ys) arrays for correlation analysis. Same-day entries within a series are summed (so daily totals are compared, not individual rows). Optional lagDays shifts seriesA backwards relative to seriesB — e.g. lagDays=1 pairs YESTERDAY\'s seriesA with TODAY\'s seriesB (useful for "did last night\'s sleep affect today\'s shooting %?"). Returns the paired arrays plus the dates that paired.',
    inputSchema: z.object({
      seriesA: z.array(z.object({ date: z.string().regex(ISO_DATE_RE), value: z.number() })),
      seriesB: z.array(z.object({ date: z.string().regex(ISO_DATE_RE), value: z.number() })),
      lagDays: z.number().int().min(-30).max(30).optional().describe('Shift seriesA by this many days before aligning. Positive means seriesA precedes seriesB.'),
    }),
    outputSchema: z.object({
      xs: z.array(z.number()),
      ys: z.array(z.number()),
      dates: z.array(z.string()),
      n: z.number(),
    }),
  },
  async (input) => alignSeriesByDate(input.seriesA, input.seriesB, input.lagDays ?? 0)
);

const calculateCorrelationTool = ai.defineTool(
  {
    name: 'calculate_correlation',
    description: `Computes Pearson correlation (r) between two equal-length numeric arrays plus an approximate two-sided p-value. Refuses to report a result when n < ${MIN_N_FOR_CORRELATION} (returns magnitude="insufficient_data"). Returns a magnitude bucket so you can describe strength in plain English. Use this after align_series_by_date.`,
    inputSchema: z.object({
      xs: z.array(z.number()),
      ys: z.array(z.number()),
    }),
    outputSchema: z.object({
      n: z.number(),
      pearson: z.number().nullable(),
      pValueApprox: z.number().nullable(),
      magnitude: z.enum(['negligible', 'weak', 'moderate', 'strong', 'very_strong', 'insufficient_data']),
      caveat: z.string(),
    }),
  },
  async (input) => correlation(input.xs, input.ys)
);

export const dataAnalystFlow = ai.defineFlow(
  {
    name: 'dataAnalystFlow',
    inputSchema: z.object({
      userId: z.string(),
      localDate: z.string(),
      query: z.string(),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    const { text } = await ai.generate({
      model: 'googleai/gemini-3-flash-preview',
      system: `You are the "Data Analyst" agent for a fitness/health app.
Your job is to answer complex analytical questions about the user's fitness data — comparing days of the week, analyzing variances, spotting long-term trends, AND computing correlations between any two series they track (food, exercise, fasting, custom performance metrics like basketball shooting %).

YOU ARE INVOKED REACTIVELY. The user (or a coach handing off to you) has asked for advice, feedback, or "why is X trending." Answer the question they asked — do not editorialize beyond it.

CONTEXT VALUES (use these in every tool call):
- userId: ${input.userId}
- localDate: ${input.localDate}

TOOLS:
1. fetch_historical_data — pull raw logs (food / exercise / fasting / custom). For custom metrics pass metricKey.
2. calculate_statistics — mean, variance, stdDev, min, max, sum.
3. align_series_by_date — pair two date-stamped series into (xs, ys) for correlation. Use lagDays when one series should precede the other (e.g. last night's sleep -> today's shooting %, lagDays=1).
4. calculate_correlation — Pearson r + approximate p-value + magnitude bucket. Returns magnitude="insufficient_data" when n < ${MIN_N_FOR_CORRELATION}.

WORKFLOW:
1. ALWAYS call fetch_historical_data first to get the raw data.
2. Reduce each log type to a one-value-per-day series before correlating (shooting %: take the day's value; sleep hours: sum durations; protein: sum proteinG; total volume: sum sets*reps*weightKg).
3. Limit yourself to AT MOST 3 candidate predictors per question. Don't fish across dozens of variables.
4. Call align_series_by_date, then calculate_correlation.
5. ALWAYS report n alongside the magnitude and the "correlation, not causation" caveat. When n < ${MIN_N_FOR_CORRELATION}, say "need more data — keep logging" rather than guessing.

OUTPUT STYLE:
- Highly analytical, "quant" tone. Give the hard numbers.
- Lead with the answer, then the math (r, n, p, magnitude). Keep it tight.
- End with one suggested next data point to collect or one actionable next step.`,
      prompt: input.query,
      tools: [fetchHistoricalDataTool, calculateStatsTool, alignSeriesByDateTool, calculateCorrelationTool],
      config: {
        temperature: 0.2,
      }
    });

    return text;
  }
);

'use server';

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService as healthService } from '@/lib/health-service-admin';

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
    description: 'Fetches the user\'s exercise, food, or fasting logs over a specified number of days. It returns the raw entries with their dates so you can filter by day of the week, exercise type, etc.',
    inputSchema: z.object({
      userId: z.string(),
      localDate: z.string().describe('The current local date YYYY-MM-DD from the client, used as the anchor for "today"'),
      type: z.enum(['food', 'exercise', 'fasting']),
      daysBack: z.number().describe('Number of days to look back. e.g. 30 for a month, 90 for a quarter. Max 180.'),
    }),
    outputSchema: z.any(),
  },
  async (input) => {
    const firestore = getAdminFirestore();
    const daysBack = Math.min(input.daysBack, 180);
    const [year, month, day] = input.localDate.split('-').map(Number);
    const startDate = new Date(year, month - 1, day - (daysBack - 1));
    const startDateStr = startDate.toLocaleDateString('en-CA');

    if (input.type === 'exercise') {
      const ref = firestore.collection(`users/${input.userId}/exercise_log`);
      const snapshot = await ref
        .where('date', '>=', startDateStr)
        .where('date', '<=', input.localDate)
        .limit(500)
        .get();
      return snapshot.docs
        .map(d => ({ ...d.data(), id: d.id }))
        .filter((e: any) => !e.ignored);
    }

    if (input.type === 'food') {
      const ref = firestore.collection(`users/${input.userId}/food_log`);
      const snapshot = await ref
        .where('date', '>=', startDateStr)
        .where('date', '<=', input.localDate)
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
        startDateStr,
        input.localDate,
        200
      );
    }
  }
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
      // We use Gemini 3 Flash Preview for everything
      model: 'googleai/gemini-3-flash-preview',
      system: `You are the "Data Analyst" agent for a fitness/health app.
Your job is to answer complex analytical questions from the user about their fitness data (e.g., comparing days of the week, analyzing variances in calorie burn, spotting long-term trends).
You have tools to fetch their historical data (up to 180 days) and to calculate statistics (mean, variance, standard deviation).
1. ALWAYS use the fetch_historical_data tool to get the data you need. 
2. Identify the relevant data points (e.g. filter by day of week or exercise name).
3. Use the calculate_statistics tool to do the math to ensure accuracy. DO NOT do complex math in your head.
4. Provide a highly analytical, insightful, and data-driven summary of your findings. Give the user the hard numbers (averages, standard deviations, etc.) in a friendly, "quant" tone.`,
      prompt: input.query,
      tools: [fetchHistoricalDataTool, calculateStatsTool],
      config: {
        temperature: 0.2,
      }
    });

    return text;
  }
);

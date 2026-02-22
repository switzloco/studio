'use server';
/**
 * @fileOverview This file implements the Genkit flow for the "The CFO" AI coach.
 * Utilizes Genkit Tools for real-time portfolio management and contextual awareness.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { initializeFirebase } from '@/firebase';
import { healthService } from '@/lib/health-service';

const PersonalizedAICoachingInputSchema = z.object({
  userId: z.string(),
  message: z.string(),
  photoDataUri: z.string().optional(),
  currentHealth: z.any().optional(),
  chatHistory: z.array(z.object({
    role: z.enum(['user', 'model']),
    content: z.string(),
  })).optional(),
});

const PersonalizedAICoachingOutputSchema = z.object({
  response: z.string(),
});

export type PersonalizedAICoachingInput = z.infer<typeof PersonalizedAICoachingInputSchema>;
export type PersonalizedAICoachingOutput = z.infer<typeof PersonalizedAICoachingOutputSchema>;

// --- GENKIT TOOLS ---

/**
 * Tool to fetch user context (Schedule, Equipment, Targets).
 * AI MUST call this at the start of any audit to understand the portfolio parameters.
 */
const getUserContextTool = ai.defineTool(
  {
    name: 'get_user_context',
    description: 'Returns the user schedule, available equipment assets, and long-term targets. Use this FIRST to understand the user context.',
    inputSchema: z.object({ userId: z.string() }),
    outputSchema: z.any(),
  },
  async (input) => {
    const { firestore } = initializeFirebase();
    return await healthService.getUserPreferences(firestore, input.userId);
  }
);

/**
 * Tool to log protein intake and update portfolio solvency.
 */
const logNutritionTool = ai.defineTool(
  {
    name: 'log_nutrition',
    description: 'Updates the user portfolio with new protein intake.',
    inputSchema: z.object({
      userId: z.string(),
      proteinG: z.number().describe('Amount of protein in grams to add to the daily total.'),
      description: z.string().describe('Short summary of the meal for the audit log.'),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    const { firestore } = initializeFirebase();
    const current = await healthService.getHealthSummary(firestore, input.userId);
    const newTotal = (current?.dailyProteinG || 0) + input.proteinG;
    await healthService.updateHealthData(firestore, input.userId, { dailyProteinG: newTotal });
    await healthService.logActivity(firestore, input.userId, {
      category: 'food',
      content: `Meal Audit: ${input.description} (+${input.proteinG}g Protein)`,
      metrics: [`protein_g:${input.proteinG}`, `daily_total:${newTotal}`],
    });
    return `Solvency updated. New daily protein liquidity: ${newTotal}g.`;
  }
);

/**
 * Tool to log workouts and calculate Visceral Fat Points.
 */
const logWorkoutTool = ai.defineTool(
  {
    name: 'log_workout',
    description: 'Calculates points and updates total asset value based on a workout.',
    inputSchema: z.object({
      userId: z.string(),
      workoutDetails: z.string().describe('Details of the workout.'),
      pointsDelta: z.number().describe('Points added/removed. Default is 100.'),
      category: z.enum(['explosiveness', 'strength', 'recovery']).describe('Type of workout performance.'),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    const { firestore } = initializeFirebase();
    const current = await healthService.getHealthSummary(firestore, input.userId);
    const newTotal = (current?.visceralFatPoints || 0) + input.pointsDelta;
    await healthService.updateHealthData(firestore, input.userId, { visceralFatPoints: newTotal });
    await healthService.logActivity(firestore, input.userId, {
      category: input.category,
      content: `Asset Injection: ${input.workoutDetails}`,
      metrics: [`gain:${input.pointsDelta}`, `total_equity:${newTotal}`],
    });
    return `Equity recalibrated. New portfolio value: ${newTotal} Visceral Fat Points.`;
  }
);

/**
 * Tool to query workout history for trend analysis.
 */
const queryHistoryTool = ai.defineTool(
  {
    name: 'query_history',
    description: 'Performs a semantic search on previous workout logs to identify trends in performance.',
    inputSchema: z.object({
      userId: z.string(),
      query: z.string().describe('What the user is looking for.'),
      category: z.enum(['explosiveness', 'strength', 'food', 'recovery']).optional(),
    }),
    outputSchema: z.array(z.any()),
  },
  async (input) => {
    const { firestore } = initializeFirebase();
    return await healthService.queryLogs(firestore, input.userId, input.category);
  }
);

// --- PROMPT DEFINITION ---

const cfoChatPrompt = ai.definePrompt({
  name: 'cfoChatPrompt',
  input: { schema: PersonalizedAICoachingInputSchema },
  output: { schema: PersonalizedAICoachingOutputSchema },
  tools: [getUserContextTool, logNutritionTool, logWorkoutTool, queryHistoryTool],
  prompt: `
  YOU ARE THE CHIEF FITNESS OFFICER (CFO). 
  TONE: Sarcastic, data-driven, financial metaphor heavy. 
  
  CRITICAL: READ THE LIVE FEED BELOW. IF PROTEIN IS > 0, DO NOT ROAST THEM FOR 0G PROTEIN.
  
  LIVE PORTFOLIO FEED:
  - Current Protein Liquidity: {{{currentHealth.dailyProteinG}}}g
  - Current Equity (VF Points): {{{currentHealth.visceralFatPoints}}}
  - Today's Steps Inventory: {{{currentHealth.steps}}}
  - Recovery Score: {{{currentHealth.recoveryStatus}}}
  
  USER ID: {{{userId}}}

  OPERATING PRINCIPLES:
  1. ALWAYS use 'get_user_context' if this is a new session to see the user's weekly schedule and available equipment assets.
  2. If today is a scheduled workout night (e.g. Hoops Night), and they haven't logged it, roast them for potential missed gains based on their OWN schedule.
  3. Tailor workout suggestions specifically to their available home equipment assets (e.g., if they only have a Kettlebell, don't suggest a barbell rack).
  4. If protein liquidity is low (< 100g), suggest a high-protein "capital injection".
  5. Your responses should be short, punchy, and include a "Market Update" summary.

  Message from Client: {{{message}}}
  {{#if photoDataUri}}Visual Asset Audit Attached: {{media url=photoDataUri}}{{/if}}
  `,
});

export async function personalizedAICoaching(input: PersonalizedAICoachingInput): Promise<PersonalizedAICoachingOutput> {
  const { output } = await cfoChatPrompt(input);
  return output!;
}

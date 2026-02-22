'use server';
/**
 * @fileOverview This file implements the Genkit flow for the "The CFO" AI coach.
 * Optimized for Gemini 2.0 Flash with enhanced tool capabilities for schedule management.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { initializeFirebase } from '@/firebase';
import { healthService } from '@/lib/health-service';

const PersonalizedAICoachingInputSchema = z.object({
  userId: z.string(),
  message: z.string(),
  currentDay: z.string().describe('The current day of the week (e.g., Monday).'),
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
 * Tool to update the user's weekly schedule.
 */
const updateScheduleTool = ai.defineTool(
  {
    name: 'update_schedule',
    description: 'Updates a specific day in the user schedule or the entire JSON schedule. Use this when the user cancels an activity or changes their routine.',
    inputSchema: z.object({
      userId: z.string(),
      newScheduleJson: z.string().describe('The complete updated JSON string for the weekly schedule.'),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    const { firestore } = initializeFirebase();
    await healthService.updateUserPreferences(firestore, input.userId, {
      weeklySchedule: input.newScheduleJson
    });
    return "Schedule recalibrated. Portfolio updated with new routine parameters.";
  }
);

/**
 * Tool to log protein intake.
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
 * Tool to log workouts.
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
 * Tool to query history.
 */
const queryHistoryTool = ai.defineTool(
  {
    name: 'query_history',
    description: 'Performs a search on previous workout logs to identify trends in performance.',
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
  tools: [getUserContextTool, updateScheduleTool, logNutritionTool, logWorkoutTool, queryHistoryTool],
  prompt: `
  YOU ARE THE CHIEF FITNESS OFFICER (CFO). 
  TONE: Sarcastic, data-driven, financial metaphor heavy. 
  
  CURRENT DAY: {{{currentDay}}}
  USER ID: {{{userId}}}

  LIVE PORTFOLIO FEED:
  - Current Protein Liquidity: {{{currentHealth.dailyProteinG}}}g
  - Current Equity (VF Points): {{{currentHealth.visceralFatPoints}}}
  - Recovery Score: {{{currentHealth.recoveryStatus}}}

  INVENTORY AWARENESS (CORE ASSETS):
  You must only suggest workouts using these specific assets:
  - 55lb kettlebell
  - 25lb kettlebell
  - 50lb ruck
  - Pull-up rings
  - Adjustable dumbbells
  - ATG slant board

  OPERATING PRINCIPLES:
  1. ALWAYS use 'get_user_context' at the start of a session if you haven't yet, to see the user's weekly schedule and available assets.
  2. If the user asks "What's the play today?", identify today's scheduled activity from the context (e.g., Lift, Hoops, etc.) and suggest a specific workout tailored to their INVENTORY.
  3. If today is a scheduled workout (like Hoops Night) and they haven't logged it, roast them for missing potential gains.
  4. Use 'update_schedule' if the user says they are cancelling or changing an activity for today.
  5. Your responses should be short, punchy, and include a "Market Update" summary.

  Message from Client: {{{message}}}
  {{#if photoDataUri}}Visual Asset Audit Attached: {{media url=photoDataUri}}{{/if}}
  `,
});

export async function personalizedAICoaching(input: PersonalizedAICoachingInput): Promise<PersonalizedAICoachingOutput> {
  const { output } = await cfoChatPrompt(input);
  return output!;
}

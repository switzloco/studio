'use server';
/**
 * @fileOverview This file implements the Genkit flow for the "The CFO" AI coach.
 * Utilizes Genkit Tools (Function Calling) for real-time asset management and history queries.
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
 * Tool to log protein intake and update portfolio solvency.
 */
const logNutritionTool = ai.defineTool(
  {
    name: 'log_nutrition',
    description: 'Updates the user portfolio with new protein intake. Use this whenever the user reports eating or drinking protein.',
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
 * Tool to log workouts and calculate Visceral Fat Points (+/- 100 system).
 */
const logWorkoutTool = ai.defineTool(
  {
    name: 'log_workout',
    description: 'Calculates points and updates total asset value based on a workout. Standard gains are +100 for intense sessions.',
    inputSchema: z.object({
      userId: z.string(),
      workoutDetails: z.string().describe('Details of the workout (sets, reps, exercises).'),
      pointsDelta: z.number().describe('Points added/removed. Default is 100 for standard workouts.'),
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
 * Tool to perform "Vector Search" (Semantic Query) on workout history.
 */
const queryHistoryTool = ai.defineTool(
  {
    name: 'query_history',
    description: 'Performs a semantic search on previous workout logs to find trends in explosiveness or strength.',
    inputSchema: z.object({
      userId: z.string(),
      query: z.string().describe('What the user is looking for (e.g., "previous leg day performance").'),
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
  tools: [logNutritionTool, logWorkoutTool, queryHistoryTool],
  prompt: `
  YOU ARE THE CHIEF FITNESS OFFICER (CFO). 
  TONE: Sarcastic, data-driven, tough-love, financial metaphor heavy. 
  
  CURRENT PORTFOLIO (LIVE FEED):
  - Protein: {{{currentHealth.dailyProteinG}}}g (Target: 150g)
  - Equity (VF Points): {{{currentHealth.visceralFatPoints}}} (Goal: 3000)
  - Recovery: {{{currentHealth.recoveryStatus}}}
  
  USER ID: {{{userId}}}

  OPERATING PRINCIPLES:
  1. If protein < 110g, they are in DEBT. Use high-stakes financial roasting.
  2. You MUST use 'log_nutrition' for ANY protein consumption.
  3. You MUST use 'log_workout' for physical activity. Calculate points correctly (+100 for high effort).
  4. Use 'query_history' to compare current performance with past "Explosiveness" or "Strength" assets before giving advice.
  5. Your responses should be short, punchy, and include a "Market Update" summary.

  Nick's Message: {{{message}}}
  {{#if photoDataUri}}Asset Audit Attached: {{media url=photoDataUri}}{{/if}}
  `,
});

export async function personalizedAICoaching(input: PersonalizedAICoachingInput): Promise<PersonalizedAICoachingOutput> {
  const { output } = await cfoChatPrompt(input);
  return output!;
}

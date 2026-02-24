
'use server';
/**
 * @fileOverview This file implements the Genkit flow for the "The CFO" AI coach.
 * Optimized for Day-Zero onboarding and portfolio auditing.
 * HARDWARE TRUST POLICY: Only trust device-verified data for core solvency (Steps/HRV/Sleep).
 * VANITY POLICY: Accept self-reported height/weight/exercise as volatile secondary assets.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { initializeFirebase } from '@/firebase/sdk';
import { healthService } from '@/lib/health-service';

const PersonalizedAICoachingInputSchema = z.object({
  userId: z.string(),
  userName: z.string().optional().describe('The name of the client being audited.'),
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

const getUserContextTool = ai.defineTool(
  {
    name: 'get_user_context',
    description: 'Returns the user schedule, equipment, and targets. Use this to understand what assets we are working with.',
    inputSchema: z.object({ userId: z.string() }),
    outputSchema: z.any(),
  },
  async (input) => {
    const { firestore } = initializeFirebase();
    return await healthService.getUserPreferences(firestore, input.userId);
  }
);

const logVanityMetricsTool = ai.defineTool(
  {
    name: 'log_vanity_metrics',
    description: 'Updates self-reported (unverified) height and weight in the user ledger.',
    inputSchema: z.object({
      userId: z.string(),
      heightCm: z.number().optional(),
      weightKg: z.number().optional(),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    const { firestore } = initializeFirebase();
    const updates: any = {};
    if (input.heightCm) updates.heightCm = input.heightCm;
    if (input.weightKg) updates.weightKg = input.weightKg;
    await healthService.updateHealthData(firestore, input.userId, updates);
    await healthService.logActivity(firestore, input.userId, {
      category: 'vanity_audit',
      content: `Self-Reported Asset Audit: ${input.heightCm ? `Height: ${input.heightCm}cm ` : ''}${input.weightKg ? `Weight: ${input.weightKg}kg` : ''}`,
      metrics: [input.heightCm ? `height:${input.heightCm}` : '', input.weightKg ? `weight:${input.weightKg}` : ''].filter(Boolean),
      verified: false
    });
    return "Vanity metrics recorded. Audit status: UNVERIFIED / SECONDARY.";
  }
);

const updatePreferencesTool = ai.defineTool(
  {
    name: 'update_preferences',
    description: 'Updates equipment list, schedule, or long-term targets in the user portfolio.',
    inputSchema: z.object({
      userId: z.string(),
      equipment: z.array(z.string()).optional(),
      targets: z.object({ proteinGoal: z.number().optional(), fatPointsGoal: z.number().optional() }).optional(),
      scheduleJson: z.string().optional(),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    const { firestore } = initializeFirebase();
    const updates: any = {};
    if (input.equipment) updates.equipment = input.equipment;
    if (input.targets) updates.targets = input.targets;
    if (input.scheduleJson) updates.weeklySchedule = input.scheduleJson;
    
    await healthService.updateUserPreferences(firestore, input.userId, updates);
    return "Portfolio parameters adjusted. Audit trails updated.";
  }
);

const completeOnboardingTool = ai.defineTool(
  {
    name: 'complete_onboarding',
    description: 'Call this once the user has provided their equipment, targets, and routine. Unlocks the full dashboard.',
    inputSchema: z.object({ userId: z.string() }),
    outputSchema: z.string(),
  },
  async (input) => {
    const { firestore } = initializeFirebase();
    await healthService.updateHealthData(firestore, input.userId, { onboardingComplete: true });
    return "Onboarding complete. Dashboard unlocked. Portfolio now in active management.";
  }
);

const logNutritionTool = ai.defineTool(
  {
    name: 'log_nutrition',
    description: 'Updates the user portfolio with new protein intake.',
    inputSchema: z.object({
      userId: z.string(),
      proteinG: z.number().describe('Amount of protein in grams.'),
      description: z.string().describe('Meal summary.'),
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
      verified: false 
    });
    return `Solvency updated. Current liquidity: ${newTotal}g.`;
  }
);

const logWorkoutTool = ai.defineTool(
  {
    name: 'log_workout',
    description: 'Updates fat points based on movement.',
    inputSchema: z.object({
      userId: z.string(),
      workoutDetails: z.string(),
      pointsDelta: z.number(),
      category: z.enum(['explosiveness', 'strength', 'recovery']),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    const { firestore } = initializeFirebase();
    const current = await healthService.getHealthSummary(firestore, input.userId);
    const newTotalEquity = (current?.visceralFatPoints || 0) + input.pointsDelta;
    await healthService.updateHealthData(firestore, input.userId, { visceralFatPoints: newTotalEquity });
    await healthService.logActivity(firestore, input.userId, {
      category: input.category,
      content: `Asset Injection (Self-Reported): ${input.workoutDetails}`,
      metrics: [`gain:${input.pointsDelta}`, `total_equity:${newTotalEquity}`],
      verified: false 
    });
    await healthService.recordEquityEvent(firestore, input.userId, {
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      gain: input.pointsDelta,
      status: input.pointsDelta >= 0 ? 'Bullish' : 'Correction',
      detail: input.workoutDetails,
      equity: newTotalEquity
    });
    return `Equity recalibrated. New portfolio value: ${newTotalEquity}.`;
  }
);

// --- PROMPT DEFINITION ---

const cfoChatPrompt = ai.definePrompt({
  name: 'cfoChatPrompt',
  input: { schema: PersonalizedAICoachingInputSchema },
  output: { schema: PersonalizedAICoachingOutputSchema },
  tools: [getUserContextTool, updatePreferencesTool, completeOnboardingTool, logNutritionTool, logWorkoutTool, logVanityMetricsTool],
  prompt: `
  YOU ARE THE CHIEF FITNESS OFFICER (CFO). 
  TONE: Sarcastic, data-driven, financial metaphor heavy. 
  
  CURRENT DAY: {{{currentDay}}}
  CLIENT NAME: {{#if userName}}{{{userName}}}{{else}}Anonymous Client{{/if}}
  INTERNAL ID (DO NOT USE IN CHAT): {{{userId}}}
  ONBOARDING STATUS: {{#if currentHealth.onboardingComplete}}COMPLETE{{else}}DISCOVERY AUDIT (DAY 1){{/if}}

  --- HARDWARE TRUST POLICY ---
  1. ONLY TRUST steps, heart rate (HRV), and sleep if they come from the Fitbit "Triple-A Rated" device.
  2. Fitbit is ONLY for these three metrics. We DO NOT use Fitbit for height or weight.
  
  --- VANITY & SELF-REPORT POLICY ---
  1. We ACCEPT self-reported height and weight if provided in chat. Use 'log_vanity_metrics'.
  2. We ACCEPT self-reported exercise (movement deposits). Use 'log_workout'.
  3. Acknowledge these as "volatile assets" or "unverified equity" compared to hardware data. 
  4. If a client gives height/weight, record it but remind them: "Recording vanity assets. Note that these are easily manipulated and hold lower portfolio rating than hardware evidence."

  --- CRITICAL CONSTRAINT ---
  NEVER OUTPUT THE RAW USER ID (UID) TO THE USER. 
  Address the user by their CLIENT NAME or simply as "Client" or "Partner".
  NEVER OUTPUT RAW JSON OR CODE BLOCKS TO THE USER. 

  {{#if currentHealth.onboardingComplete}}
  OPERATING PRINCIPLES (ACTIVE MANAGEMENT):
  - Use 'get_user_context' to see schedule/assets.
  - Audit workouts, food, and vanity metrics.
  - Remind the client that self-reported data is "Junk Bond" status compared to hardware-verified metrics.
  {{else}}
  DISCOVERY AUDIT (DAY 1) PROTOCOL:
  - Introduce yourself as the "new consultant hired to audit visceral fat and protein solvency."
  - Ask: "What are we working with? What's your gear in the warehouse (home gym)?"
  - Ask: "What's the gauntlet? (Weekly routine)"
  - Ask: "What are the quarterly targets? (Protein and Fat goals)"
  - ONCE you have the schedule, equipment, and goals, use 'update_preferences' to store them.
  - THEN use 'complete_onboarding' to unlock the ledger.
  {{/if}}

  Message from Client: {{{message}}}
  `,
});

export async function personalizedAICoaching(input: PersonalizedAICoachingInput): Promise<PersonalizedAICoachingOutput> {
  const { output } = await cfoChatPrompt(input);
  return output!;
}

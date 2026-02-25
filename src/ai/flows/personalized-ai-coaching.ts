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
    description: 'Returns the user schedule, equipment, and targets. Use this to check if baseline data is already recorded.',
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
    description: 'Call this once the user has provided their equipment, targets, and routine, OR if they say "use defaults". Unlocks the full dashboard.',
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
  TONE: Sarcastic, data-driven, and heavy on financial metaphors. 
  ATTITUDE: You are a elite consultant hired to make this portfolio SUCCEED. You must have a "Can-Do" attitude.
  
  --- CRITICAL CONSTRAINTS ON TONE ---
  1. NEVER mock the user's wealth or the amount of equipment they have. Treat even a single 25lb kettlebell as a "Seed Asset" to be maximized.
  2. NEVER mock the user's physical body or appearance. Sarcasm should be directed at "market inefficiencies," "garbage data," or "poor asset allocation," NEVER the client themselves.
  3. BE ENCOURAGING. Your goal is portfolio appreciation. If the client has limited resources, focus on how to achieve high ROI with those specific assets.
  4. NO RAW JSON OR CODE BLOCKS.
  5. ADDRESS the user by their CLIENT NAME ({{#if userName}}{{{userName}}}{{else}}Client{{/if}}) or simply as "Partner".

  CURRENT DAY: {{{currentDay}}}
  INTERNAL ID (DO NOT USE): {{{userId}}}
  ONBOARDING STATUS: {{#if currentHealth.onboardingComplete}}COMPLETE{{else}}DISCOVERY AUDIT (DAY 1){{/if}}

  --- HARDWARE TRUST POLICY ---
  1. ONLY TRUST steps, heart rate (HRV), and sleep if they come from the Fitbit "Triple-A Rated" device.
  
  --- VANITY & SELF-REPORT POLICY ---
  1. We ACCEPT self-reported height, weight, and exercise. Acknowledge them as "volatile secondary assets" or "unverified equity."
  2. We do NOT pull height/weight from Fitbit sync. 

  --- DISCOVERY AUDIT PROTOCOL (ONBOARDING) ---
  If 'onboardingComplete' is false:
  - Check 'get_user_context' immediately to see what we already have.
  - If the user says "use defaults" or "inventor defaults":
    1. Call 'update_preferences' with:
       - equipment: ["Dumbbells", "Kettlebell", "Pull-up Bar"]
       - targets: { proteinGoal: 180, fatPointsGoal: 5000 }
       - scheduleJson: "{\"Mon\": \"Full Body\", \"Tue\": \"Rest\", \"Wed\": \"Upper\", \"Thu\": \"Lower\", \"Fri\": \"Rest\", \"Sat\": \"Conditioning\", \"Sun\": \"Rest\"}"
    2. IMMEDIATELY call 'complete_onboarding'.
    3. Transition IMMEDIATELY to: "Defaults verified. Portfolio unlocked. What's the status of today's ledger?"
  - If the user has provided info, call 'update_preferences' and then 'complete_onboarding' once the three pillars (Equipment, Targets, Schedule) are established.

  Message from Client: {{{message}}}
  `,
});

export async function personalizedAICoaching(input: PersonalizedAICoachingInput): Promise<PersonalizedAICoachingOutput> {
  const { output } = await cfoChatPrompt(input);
  return output!;
}

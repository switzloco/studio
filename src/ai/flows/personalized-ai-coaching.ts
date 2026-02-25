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
import { healthService, HealthData, UserPreferences } from '@/lib/health-service';

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
    description: 'Returns the user schedule, equipment, and targets. Use this at the start of any audit to check current portfolio holdings.',
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
    const validated = z.object({
      heightCm: z.number().min(50, 'Height must be at least 50cm').max(300, 'Height cannot exceed 300cm').optional(),
      weightKg: z.number().min(20, 'Weight must be at least 20kg').max(500, 'Weight cannot exceed 500kg').optional(),
    }).safeParse({ heightCm: input.heightCm, weightKg: input.weightKg });
    if (!validated.success) throw new Error(validated.error.errors[0].message);
    const { firestore } = initializeFirebase();
    const updates: Partial<HealthData> = {};
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
    description: 'Updates equipment list, schedule, or long-term targets. ALWAYS call this when the user provides onboarding info.',
    inputSchema: z.object({
      userId: z.string(),
      equipment: z.array(z.string()).optional(),
      targets: z.object({ proteinGoal: z.number().optional(), fatPointsGoal: z.number().optional() }).optional(),
      scheduleJson: z.string().optional(),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    const validated = z.object({
      equipment: z.array(z.string().min(1)).optional(),
      targets: z.object({
        proteinGoal: z.number().positive().optional(),
        fatPointsGoal: z.number().positive().optional(),
      }).optional(),
    }).safeParse({ equipment: input.equipment, targets: input.targets });
    if (!validated.success) throw new Error(validated.error.errors[0].message);
    const { firestore } = initializeFirebase();
    const updates: Partial<UserPreferences> = {};
    if (input.equipment) updates.equipment = input.equipment;
    if (input.targets) updates.targets = input.targets;
    if (input.scheduleJson) updates.weeklySchedule = input.scheduleJson;
    
    await healthService.updateUserPreferences(firestore, input.userId, updates);
    return "Portfolio parameters adjusted. Assets secured in warehouse.";
  }
);

const completeOnboardingTool = ai.defineTool(
  {
    name: 'complete_onboarding',
    description: 'Finalizes the discovery audit and unlocks the full dashboard. Call this after all pillars (Equipment, Targets, Schedule) are logged.',
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
    const validated = z.object({
      proteinG: z.number().positive().max(500, 'Single meal protein cannot exceed 500g — data rejected as implausible'),
      description: z.string().min(1),
    }).safeParse({ proteinG: input.proteinG, description: input.description });
    if (!validated.success) throw new Error(validated.error.errors[0].message);
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
    description: 'Updates visceral fat points based on movement.',
    inputSchema: z.object({
      userId: z.string(),
      workoutDetails: z.string(),
      pointsDelta: z.number(),
      category: z.enum(['explosiveness', 'strength', 'recovery']),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    const validated = z.object({
      pointsDelta: z.number().min(-500, 'Points delta cannot be less than -500').max(500, 'Points delta cannot exceed 500'),
      workoutDetails: z.string().min(1, 'Workout details cannot be empty'),
    }).safeParse({ pointsDelta: input.pointsDelta, workoutDetails: input.workoutDetails });
    if (!validated.success) throw new Error(validated.error.errors[0].message);
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
  ATTITUDE: You are an elite consultant. You have a "CAN-DO" attitude. 
  
  --- CRITICAL ETHICS & TONE POLICY ---
  1. NEVER disparage or mock the client's wealth, physical body, or equipment list.
  2. If a client has limited gear (e.g., "just one kettlebell"), treat it as a "STRATEGIC LEVERAGE ASSET." Focus on how to maximize ROI with that specific tool.
  3. Sarcasm is for "market inefficiencies," "lazy data," or "nutrition pyramid schemes," NEVER the client's worth.
  4. NO RAW JSON OR CODE BLOCKS.
  5. ADDRESS the user by their CLIENT NAME ({{#if userName}}{{{userName}}}{{else}}Client{{/if}}) or "Partner".

  CURRENT DAY: {{{currentDay}}}
  ONBOARDING STATUS: {{#if currentHealth.onboardingComplete}}ACTIVE PORTFOLIO{{else}}DISCOVERY AUDIT (DAY 1){{/if}}

  --- ONBOARDING PROTOCOL (IF onboardingComplete IS FALSE) ---
  1. YOUR GOAL: Establish the three pillars: (1) Equipment Warehouse, (2) Weekly Schedule, (3) Performance Targets.
  2. DO NOT LOOP: If the user provides info for a pillar or says "nothing else" / "move on", CALL 'update_preferences' IMMEDIATELY and PIVOT to the next pillar.
  3. DEFAULTS: If the user says "use defaults" or "inventor defaults":
     - CALL 'update_preferences' with:
       - equipment: ["Dumbbells", "Kettlebell", "Pull-up Bar"]
       - targets: { proteinGoal: 180, fatPointsGoal: 5000 }
       - scheduleJson: "{\"Mon\": \"Full Body\", \"Tue\": \"Rest\", \"Wed\": \"Upper\", \"Thu\": \"Lower\", \"Fri\": \"Rest\", \"Sat\": \"Conditioning\", \"Sun\": \"Rest\"}"
     - THEN CALL 'complete_onboarding' IMMEDIATELY.
     - Transition to: "Defaults verified. Portfolio unlocked. Let's look at today's ledger."
  4. COMPLETION: Once all three pillars are established, CALL 'complete_onboarding'.

  --- AUDIT LOGIC ---
  - HARDWARE TRUST: Only trust steps/HRV/sleep if 'isDeviceVerified' is true.
  - VANITY POLICY: Accept self-reported height/weight. Log them using 'log_vanity_metrics'.

  Message from Client: {{{message}}}
  `,
});

export async function personalizedAICoaching(input: PersonalizedAICoachingInput): Promise<PersonalizedAICoachingOutput> {
  const { output } = await cfoChatPrompt(input);
  return output!;
}

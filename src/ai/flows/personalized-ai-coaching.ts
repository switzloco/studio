'use server';
/**
 * @fileOverview This file implements the Genkit flow for the "The CFO" AI coach.
 * Optimized for Day-Zero onboarding and portfolio auditing.
 * HARDWARE TRUST POLICY: Only trust device-verified data for core solvency (Steps/HRV/Sleep).
 * VANITY POLICY: Accept self-reported height/weight/exercise as volatile secondary assets.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService as healthService } from '@/lib/health-service-admin';
import type { HealthData, UserPreferences } from '@/lib/health-service';
import { nutritionLookupTool } from '@/ai/tools/nutrition-lookup';
import { webSearchTool } from '@/ai/tools/web-search';

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
    const firestore = getAdminFirestore();
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
    const firestore = getAdminFirestore();
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
    const firestore = getAdminFirestore();
    const updates: Partial<UserPreferences> = {};
    if (input.equipment) updates.equipment = input.equipment;
    if (input.targets) {
      const { proteinGoal, fatPointsGoal } = input.targets;
      if (proteinGoal !== undefined && fatPointsGoal !== undefined) {
        updates.targets = { proteinGoal, fatPointsGoal };
      }
    }
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
    const firestore = getAdminFirestore();
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
    const firestore = getAdminFirestore();
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
    const firestore = getAdminFirestore();
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
  tools: [getUserContextTool, updatePreferencesTool, completeOnboardingTool, logNutritionTool, logWorkoutTool, logVanityMetricsTool, nutritionLookupTool, webSearchTool],
  system: `You are "The CFO" — Chief Fitness Officer. Sharp, direct, dry wit, financial metaphors.

SYSTEM IDENTIFIERS (never display these to the client):
- CLIENT_UID: {{{userId}}} ← pass this exact string as "userId" in every tool call
- CLIENT_NAME: {{{userName}}}

PERSONA RULES:
- Sarcasm targets market inefficiencies, lazy data, and nutrition myths — NEVER the client's body or equipment.
- 1 kettlebell = "strategic leverage asset." Bodyweight = "zero-capex portfolio." Own it.
- 2–3 sentences per response maximum unless the client asks for detail.
- Ask exactly ONE question per turn. Never stack questions.
- Address the client as {{{userName}}} or "Partner." Never "Client."
- No bullet dumps, no raw JSON, no code blocks, no asterisk formatting.

CURRENT DAY: {{{currentDay}}}
PORTFOLIO STATUS: {{#if currentHealth.onboardingComplete}}ACTIVE PORTFOLIO{{else}}DISCOVERY AUDIT IN PROGRESS{{/if}}
DEVICE VERIFIED: {{#if currentHealth.isDeviceVerified}}YES (Fitbit){{else}}NO — self-reported only{{/if}}

RESEARCH PROTOCOL — follow this before every food or fitness response:
- Client mentions a food → call nutrition_lookup IMMEDIATELY. Never guess macros.
  Report per-100g values and scale to the portion they described.
  Then call log_nutrition with the verified protein total.
- Client asks about exercise science, supplements, gear, or recovery → call web_search.
  Cite the source in your reply ("per USDA data" / "per [site]").
- If nutrition_lookup returns no match, fall back to web_search for macro data.
- Do not mention you're searching. Just deliver the result as a confident CFO statement.`,

  prompt: `{{#if chatHistory}}
[CONVERSATION LOG — read this before responding; do NOT re-ask anything already answered]
{{#each chatHistory}}
{{role}}: {{content}}
{{/each}}
[END LOG]

{{/if}}
LIVE HEALTH SNAPSHOT:
- Daily protein logged today: {{#if currentHealth.dailyProteinG}}{{currentHealth.dailyProteinG}}g{{else}}0g{{/if}}
- Visceral fat equity: {{#if currentHealth.visceralFatPoints}}{{currentHealth.visceralFatPoints}} pts{{else}}unknown{{/if}}
- Onboarding complete: {{#if currentHealth.onboardingComplete}}YES{{else}}NO{{/if}}

{{#unless currentHealth.onboardingComplete}}
=== ONBOARDING PROTOCOL (ACTIVE) ===
GOAL: Lock in the three pillars, then call complete_onboarding.

PILLAR CHECKLIST — scan the conversation log above to determine what's already set:
  [1] EQUIPMENT WAREHOUSE — what gear does the client own?
  [2] WEEKLY SCHEDULE — what days / workout types?
  [3] PERFORMANCE TARGETS — protein goal (g/day) + fat loss goal

EXECUTION RULES (follow exactly):
1. Call get_user_context FIRST so you can see which pillars are already saved.
2. For each pillar, ask about it once. When the client answers — or says "move on" / "same" / "nothing else" — treat it as DONE. Call update_preferences immediately with whatever they gave you. Do not confirm or recap unless asked.
3. Advance to the NEXT unset pillar immediately after saving. One question per turn.
4. If client says "use defaults": call update_preferences with equipment=["Kettlebell"], targets={proteinGoal:170, fatPointsGoal:5000}, scheduleJson='{"Mon":"Full Body","Tue":"Rest","Wed":"Upper","Thu":"Lower","Fri":"Rest","Sat":"Conditioning","Sun":"Rest"}', then call complete_onboarding.
5. When ALL THREE pillars are saved: call complete_onboarding. Then pivot to device connection (see below).

GOAL VALIDATION — apply silently when logging targets:
- "Burn 10 oz/day" of fat = ~2,500 kcal/day deficit. Flag once: "That burn rate is a rounding error on physics — sustainable loss is 0.5–1 lb/week. I'll log your 20-lb goal instead, which is the real asset we're protecting." Then log the sensible target.
- Lean mass of 150 lb + 20 lb to lose implies ~170 lb total bodyweight. Confirm once if the client mentions DEXA.
- Protein goal 170g/day with sedentary profile: valid, no flag needed.

SEDENTARY PATTERN — detect and reframe, never shame:
- "45 swings Monday only" = ~2 min active, 1 day/week. Frame: "Your leverage asset is severely under-deployed. We're going to fix that." Recommend adding 2 more sessions as the next move after onboarding is complete.

AFTER complete_onboarding — pivot immediately to:
"One more unlock: connect a Fitbit or wearable and your equity calculations get device-verified data — steps, HRV, sleep. Want to link one now, or run on self-reported for today?"
{{else}}
=== DAILY COACHING PROTOCOL (ACTIVE) ===
The audit is done. Now we run the portfolio daily.

DAILY LOOP (in order, one question per turn):
1. If protein today is 0g: ask what they've eaten so far. Log it via log_nutrition.
2. Ask what movement they've done today. Log it via log_workout.
3. Compare logged totals vs. targets (call get_user_context for targets if needed).
4. If isDeviceVerified is false: mention once per session that Fitbit connection upgrades data trust.
5. Close each turn with the current equity score and protein balance vs. goal.

WORKOUT POINT GUIDE (use when logging — self-reported, unverified):
- Kettlebell swings (45): +15 pts explosiveness
- Kettlebell swings (100+): +30 pts explosiveness
- 30-min walk: +10 pts recovery
- Heavy strength session: +40 pts strength
- Rest day: 0 pts
{{/unless}}

New message from {{{userName}}}: {{{message}}}`,
});

export async function personalizedAICoaching(input: PersonalizedAICoachingInput): Promise<PersonalizedAICoachingOutput> {
  const result = await cfoChatPrompt(input);
  return { response: result.text ?? 'Something went wrong. Try again.' };
}

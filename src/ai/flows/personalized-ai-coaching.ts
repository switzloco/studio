'use server';
/**
 * @fileOverview Genkit flow for "The CFO" AI coach.
 * Natural conversational coaching — no rigid onboarding gates.
 * Persistent memory via profile + structured food/exercise logs.
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
  localDate: z.string().describe('The current local date string YYYY-MM-DD from the client.'),
  localTime: z.string().describe('The current local time string from the client.'),
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
    description: 'Returns the user profile, equipment, schedule, targets, and recent food/exercise logs. Call this at the START of every new conversation to load persistent memory.',
    inputSchema: z.object({ userId: z.string(), localDate: z.string() }),
    outputSchema: z.any(),
  },
  async (input) => {
    const firestore = getAdminFirestore();
    const today = input.localDate;
    const [prefs, health, recentFood, recentExercise] = await Promise.all([
      healthService.getUserPreferences(firestore, input.userId),
      healthService.getHealthSummary(firestore, input.userId),
      healthService.queryFoodLog(firestore, input.userId, today, 10),
      healthService.queryExerciseLog(firestore, input.userId, today, 10),
    ]);
    // Apply the same isNewDay guard the dashboard uses so the AI never sees
    // yesterday's logged intake as today's data.
    const isNewDay = health?.lastActiveDate !== today;
    return {
      preferences: prefs,
      health: {
        dailyProteinG: isNewDay ? 0 : (health?.dailyProteinG ?? 0),
        dailyCaloriesIn: isNewDay ? 0 : (health?.dailyCaloriesIn ?? 0),
        dailyCarbsG: isNewDay ? 0 : (health?.dailyCarbsG ?? 0),
        visceralFatPoints: health?.visceralFatPoints ?? 0,
        isDeviceVerified: health?.isDeviceVerified ?? false,
        steps: health?.steps ?? 0,
        weightKg: health?.weightKg,
        heightCm: health?.heightCm,
      },
      todaysFoodLog: recentFood,
      todaysExerciseLog: recentExercise,
    };
  }
);

const updatePreferencesTool = ai.defineTool(
  {
    name: 'update_preferences',
    description: 'Saves equipment, schedule, targets, or profile info (height, weight, goals, etc.) to persistent storage. Call this silently whenever the user shares personal info.',
    inputSchema: z.object({
      userId: z.string(),
      equipment: z.array(z.string()).optional(),
      targets: z.object({ proteinGoal: z.number().optional(), fatPointsGoal: z.number().optional() }).optional(),
      scheduleJson: z.string().optional(),
      profile: z.object({
        heightCm: z.number().optional(),
        weightKg: z.number().optional(),
        age: z.number().optional(),
        activityLevel: z.enum(['sedentary', 'light', 'moderate', 'active']).optional(),
        goals: z.array(z.string()).optional(),
        injuries: z.array(z.string()).optional(),
        dietaryRestrictions: z.array(z.string()).optional(),
        lastConversationSummary: z.string().optional(),
      }).optional(),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    const firestore = getAdminFirestore();
    const updates: Partial<UserPreferences> = {};
    if (input.equipment) updates.equipment = input.equipment;
    if (input.targets) {
      const { proteinGoal, fatPointsGoal } = input.targets;
      if (proteinGoal !== undefined || fatPointsGoal !== undefined) {
        // Merge with existing targets
        const existing = await healthService.getUserPreferences(firestore, input.userId);
        updates.targets = {
          proteinGoal: proteinGoal ?? existing?.targets?.proteinGoal ?? 150,
          fatPointsGoal: fatPointsGoal ?? existing?.targets?.fatPointsGoal ?? 3000,
        };
      }
    }
    if (input.scheduleJson) updates.weeklySchedule = input.scheduleJson;
    if (input.profile) {
      // Merge profile fields
      const existing = await healthService.getUserPreferences(firestore, input.userId);
      updates.profile = { ...(existing?.profile ?? {}), ...input.profile };
    }

    await healthService.updateUserPreferences(firestore, input.userId, updates);

    // Also update vanity metrics on the main health doc if provided
    if (input.profile?.heightCm || input.profile?.weightKg) {
      const healthUpdates: Partial<HealthData> = {};
      if (input.profile.heightCm) healthUpdates.heightCm = input.profile.heightCm;
      if (input.profile.weightKg) healthUpdates.weightKg = input.profile.weightKg;
      await healthService.updateHealthData(firestore, input.userId, healthUpdates);
    }

    return "Preferences saved.";
  }
);

const logFoodTool = ai.defineTool(
  {
    name: 'log_food',
    description: 'Logs a food entry with full macro breakdown to the structured food database. Call this after nutrition_lookup verifies the macros.',
    inputSchema: z.object({
      userId: z.string(),
      name: z.string().describe('Food name, e.g. "Chicken breast, grilled"'),
      portionG: z.number().describe('Portion size in grams'),
      calories: z.number(),
      proteinG: z.number(),
      carbsG: z.number(),
      fatG: z.number(),
      fiberG: z.number().optional(),
      source: z.enum(['usda', 'web_search', 'user_estimate']),
      meal: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
      localDate: z.string(),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    const validated = z.object({
      proteinG: z.number().min(0).max(500, 'Single meal protein cannot exceed 500g'),
      name: z.string().min(1),
    }).safeParse({ proteinG: input.proteinG, name: input.name });
    if (!validated.success) throw new Error(validated.error.errors[0].message);

    const firestore = getAdminFirestore();
    const today = new Date().toISOString().split('T')[0];

    // Write to structured food_log
    await healthService.logFood(firestore, input.userId, {
      name: input.name,
      portionG: input.portionG,
      calories: input.calories,
      proteinG: input.proteinG,
      carbsG: input.carbsG,
      fatG: input.fatG,
      fiberG: input.fiberG ?? 0,
      source: input.source,
      meal: input.meal,
      date: today,
    });

    // Update daily protein, carbs, calories counter on user doc
    const current = await healthService.getHealthSummary(firestore, input.userId);

    // Check if we need to reset stats (new day)
    const isNewDay = current?.lastActiveDate !== input.localDate;

    const newProteinTotal = isNewDay ? input.proteinG : (current?.dailyProteinG || 0) + input.proteinG;
    const newCarbsTotal = isNewDay ? input.carbsG : (current?.dailyCarbsG || 0) + input.carbsG;
    const newCaloriesTotal = isNewDay ? input.calories : (current?.dailyCaloriesIn || 0) + input.calories;

    await healthService.updateHealthData(firestore, input.userId, {
      dailyProteinG: newProteinTotal,
      dailyCarbsG: newCarbsTotal,
      dailyCaloriesIn: newCaloriesTotal,
      lastActiveDate: input.localDate,
    });

    // Also write to legacy logs for backward compat
    await healthService.logActivity(firestore, input.userId, {
      category: 'food',
      content: `${input.name} (${input.portionG}g) — ${input.calories} cal, ${input.proteinG}g protein`,
      metrics: [`protein_g:${input.proteinG}`, `calories:${input.calories}`, `daily_total:${newProteinTotal}`],
      verified: false,
    });

    return `Logged: ${input.name}. Daily totals -> Protein: ${newProteinTotal}g, Carbs: ${newCarbsTotal}g, Calories: ${newCaloriesTotal}.`;
  }
);

const logExerciseTool = ai.defineTool(
  {
    name: 'log_exercise',
    description: 'Logs an exercise entry to the structured exercise database.',
    inputSchema: z.object({
      userId: z.string(),
      name: z.string().describe('Exercise name, e.g. "Kettlebell swings"'),
      category: z.enum(['strength', 'conditioning', 'recovery', 'cardio']),
      sets: z.number().optional(),
      reps: z.number().optional(),
      durationMin: z.number().optional(),
      weightKg: z.number().optional(),
      estimatedCaloriesBurned: z.number().optional(),
      pointsDelta: z.number().describe('Visceral fat points earned'),
      notes: z.string().optional(),
      localDate: z.string(),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    const validated = z.object({
      pointsDelta: z.number().min(-500).max(500),
      name: z.string().min(1),
    }).safeParse({ pointsDelta: input.pointsDelta, name: input.name });
    if (!validated.success) throw new Error(validated.error.errors[0].message);

    const firestore = getAdminFirestore();
    const today = input.localDate;

    // Write to structured exercise_log
    await healthService.logExercise(firestore, input.userId, {
      name: input.name,
      category: input.category,
      sets: input.sets,
      reps: input.reps,
      durationMin: input.durationMin,
      weightKg: input.weightKg,
      estimatedCaloriesBurned: input.estimatedCaloriesBurned,
      pointsDelta: input.pointsDelta,
      notes: input.notes,
      date: today,
    });

    // Update equity on user doc
    const current = await healthService.getHealthSummary(firestore, input.userId);
    const newTotalEquity = (current?.visceralFatPoints || 0) + input.pointsDelta;
    await healthService.updateHealthData(firestore, input.userId, { visceralFatPoints: newTotalEquity });

    // Legacy log
    await healthService.logActivity(firestore, input.userId, {
      category: input.category === 'cardio' ? 'recovery' : input.category === 'conditioning' ? 'explosiveness' : input.category,
      content: `${input.name}${input.durationMin ? ` (${input.durationMin} min)` : ''}${input.reps ? ` (${input.reps} reps)` : ''} — +${input.pointsDelta} pts`,
      metrics: [`gain:${input.pointsDelta}`, `total_equity:${newTotalEquity}`],
      verified: false,
    });

    // Record equity event for the history chart
    await healthService.recordEquityEvent(firestore, input.userId, {
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      gain: input.pointsDelta,
      status: input.pointsDelta >= 0 ? 'Bullish' : 'Correction',
      detail: input.name,
      equity: newTotalEquity,
    });

    const calorieNote = input.estimatedCaloriesBurned ? ` (~${input.estimatedCaloriesBurned} cal burned)` : '';
    return `Logged: ${input.name}${calorieNote}. Equity: ${newTotalEquity} pts (+${input.pointsDelta}).`;
  }
);

const getRecentLogsTool = ai.defineTool(
  {
    name: 'get_recent_logs',
    description: 'Retrieves recent food and/or exercise logs. Use this to check what the user has logged today or recently.',
    inputSchema: z.object({
      userId: z.string(),
      type: z.enum(['food', 'exercise', 'all']),
      days: z.number().optional().describe('Number of days to look back, default 1 (today only)'),
    }),
    outputSchema: z.any(),
  },
  async (input) => {
    const firestore = getAdminFirestore();
    const daysBack = input.days ?? 1;
    const results: any = {};

    // Build date list
    const dates: string[] = [];
    for (let i = 0; i < daysBack; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().split('T')[0]);
    }

    if (input.type === 'food' || input.type === 'all') {
      const foodLogs: any[] = [];
      for (const date of dates) {
        const entries = await healthService.queryFoodLog(firestore, input.userId, date, 20);
        foodLogs.push(...entries);
      }
      results.foodLog = foodLogs;
      results.dailyProteinTotal = foodLogs.reduce((sum, e) => sum + (e.proteinG || 0), 0);
      results.dailyCalorieTotal = foodLogs.reduce((sum, e) => sum + (e.calories || 0), 0);
    }

    if (input.type === 'exercise' || input.type === 'all') {
      const exerciseLogs: any[] = [];
      for (const date of dates) {
        const entries = await healthService.queryExerciseLog(firestore, input.userId, date, 20);
        exerciseLogs.push(...entries);
      }
      results.exerciseLog = exerciseLogs;
      results.totalPointsToday = exerciseLogs.reduce((sum, e) => sum + (e.pointsDelta || 0), 0);
    }

    return results;
  }
);

// --- PROMPT DEFINITION ---

const cfoChatPrompt = ai.definePrompt({
  name: 'cfoChatPrompt',
  input: { schema: PersonalizedAICoachingInputSchema },
  tools: [getUserContextTool, updatePreferencesTool, logFoodTool, logExerciseTool, getRecentLogsTool, nutritionLookupTool, webSearchTool],
  system: `You are "The CFO" — Chief Fitness Officer. Sharp, direct, dry wit, financial metaphors.

SYSTEM IDENTIFIERS (never display these to the client):
- CLIENT_UID: {{{userId}}} — pass this exact string as "userId" in every tool call
- CLIENT_NAME: {{{userName}}}

PERSONA:
- 2-3 sentences per response unless the client asks for detail.
- Ask exactly ONE question per turn. Never stack questions.
- Address the client as {{{userName}}} or "Partner."
- No bullet dumps, no raw JSON, no code blocks, no asterisk formatting.
- Financial metaphors: protein = liquidity/assets, visceral fat = liabilities, workouts = equity injections, rest = capital preservation.
- Sarcasm targets market inefficiencies and nutrition myths, NEVER the client's body or equipment.

CURRENT DAY: {{{currentDay}}} ({{localDate}} {{localTime}})

MEMORY PROTOCOL:
Call get_user_context at the START of every new conversation to load the user's profile, equipment, targets, and recent logs. Remember to pass localDate down exactly as it was given to you.
- NEVER re-ask something already stored in their profile or preferences.
- If their profile is sparse (new user), gather information NATURALLY through conversation. Do not interrogate — ask one thing at a time and let the conversation flow.
- When the user shares info (equipment, goals, schedule, weight, height, dietary restrictions), save it immediately via update_preferences. Do not announce you are saving.
- Reference stored info naturally: "You mentioned the kettlebell last time" or "Your Thursday basketball night is coming up."

INIT PROTOCOL:
If the user message is "__init__", this is a new session start. Call get_user_context first, then:
- If profile is EMPTY (new user): Introduce yourself warmly. "Hi, I'm your new Chief Fitness Officer..." then ask ONE natural question to get started, like "What's the main thing you want to track?"
- If profile is POPULATED (returning user): Welcome them back and reference something relevant from their profile or recent logs. "Welcome back, Partner. You logged 120g protein yesterday — let's top that today."

CONVERSATION FLOW (new users — gather info naturally, not as a checklist):
When info is missing, weave questions into natural coaching conversation:
- What they want to track / their main goal
- Their weekly exercise routine
- Equipment they have access to
- Their target (weight loss, protein goal, etc.)
Do NOT treat these as a rigid sequence. If the user volunteers multiple pieces of info at once, save them all and move on. If they want to start logging immediately, let them — you can gather profile info over multiple sessions.

When you have enough info to set meaningful targets, save them and start coaching. There is no "onboarding complete" gate.

RESEARCH PROTOCOL:
- Client mentions a food -> call nutrition_lookup IMMEDIATELY. Never guess macros.
  Report key macros and scale to the portion. Then call log_food with verified data.
- Client asks about exercise science, supplements, gear, or recovery -> call web_search.
  Cite the source in your reply.
- If nutrition_lookup returns no match, fall back to web_search for macro data.
- Do not mention you are searching. Deliver results as confident CFO statements.

COACHING PROTOCOL:
- Track protein against their goal. Mention the gap naturally.
- When they report exercise, estimate calorie burn and log it. Reference their equipment and schedule.
- If isDeviceVerified is false and the context is right (they mention steps, sleep, HRV), mention Fitbit ONCE per session: "Your step data would be way more reliable with a Fitbit sync. Want to connect one?"
- Propose a point system tied to their goals. Make it feel custom, not generic.

WORKOUT POINT GUIDE (for logging — self-reported, unverified):
- Kettlebell swings (45): +15 pts explosiveness
- Kettlebell swings (100+): +30 pts explosiveness
- 30-min walk: +10 pts recovery
- 2-hour bike ride: +50 pts cardio
- Basketball game: +40 pts conditioning
- Heavy strength session: +40 pts strength
- Rest day: 0 pts

GOAL VALIDATION:
- If user sets an aggressive weight loss goal, validate it once: "That's ambitious — sustainable loss is 1-2 lb/week. I'll design the point system so if you follow it perfectly, you hit your goal with some slack built in."
- Never shame. Reframe positively.`,

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
- Device verified: {{#if currentHealth.isDeviceVerified}}YES (Fitbit){{else}}NO{{/if}}

New message from {{{userName}}}: {{{message}}}`,
});

export async function personalizedAICoaching(input: PersonalizedAICoachingInput): Promise<PersonalizedAICoachingOutput> {
  const result = await cfoChatPrompt(input);
  return { response: result.text ?? 'Something went wrong. Try again.' };
}

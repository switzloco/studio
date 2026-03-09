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
import { calculateDailyVFScore } from '@/lib/vf-scoring';
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
      today: today,
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
    description: 'Logs a food entry with macro breakdown. For a multi-food meal, sum all macros and log once (e.g. "Breakfast: eggs + sourdough + egg whites") rather than one call per ingredient.',
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
      alcoholDrinks: z.number().optional().describe('Number of alcoholic drinks in this meal (beer, wine, cocktail = 1 each). Default 0.'),
      hasSeedOils: z.boolean().optional().describe('True if the meal is heavily processed or deep-fried in industrial seed oils (soybean, canola, sunflower). Default false.'),
      consumedAt: z.string().optional().describe('HH:MM (24h) — when the user actually ate this. Infer from context (e.g. "I had lunch at noon" -> "12:00"). If unknown, use the current localTime.'),
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

    // Write to structured food_log — use the client's localDate, NOT server UTC
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
      alcoholDrinks: input.alcoholDrinks ?? 0,
      hasSeedOils: input.hasSeedOils ?? false,
      consumedAt: input.consumedAt,
      date: input.localDate,
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

    const resetNote = isNewDay ? ' [NEW DAY — daily counters reset to zero before this entry]' : '';
    return `Logged: ${input.name}.${resetNote} Today's running totals (authoritative) -> Protein: ${newProteinTotal}g, Carbs: ${newCarbsTotal}g, Calories: ${newCaloriesTotal}. Use ONLY these numbers when reporting the daily total to the client.`;
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
      sets: z.number().optional().describe('Number of sets. Default to 1 when the user mentions a rep count without specifying sets (e.g. "25 swings" = sets:1, reps:25).'),
      reps: z.number().optional(),
      durationMin: z.number().optional(),
      weightKg: z.number().optional(),
      estimatedCaloriesBurned: z.number().optional(),
      pointsDelta: z.number().describe('Visceral fat points earned'),
      notes: z.string().optional(),
      performedAt: z.string().optional().describe('HH:MM (24h) — when the user actually did this exercise. Infer from context. If unknown, use the current localTime.'),
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
      performedAt: input.performedAt,
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
    description: 'Retrieves food and/or exercise logs. Use this to check what the user logged today, review recent history, or answer questions about past performance (e.g. heaviest weight lifted, PRs, weekly patterns). Set days=7 for a week, days=30 for a month, etc. Exercise entries include weightKg, sets, reps, durationMin, and category.',
    inputSchema: z.object({
      userId: z.string(),
      localDate: z.string().describe('The current local date YYYY-MM-DD from the client, used as the anchor for "today"'),
      type: z.enum(['food', 'exercise', 'all']),
      days: z.number().optional().describe('Number of days to look back, default 1 (today only). Use 7 for a week, 30 for a month, 90 for a quarter.'),
    }),
    outputSchema: z.any(),
  },
  async (input) => {
    const firestore = getAdminFirestore();
    const daysBack = input.days ?? 1;
    const results: any = {};

    // Build date range anchored to the client's local date
    const [year, month, day] = input.localDate.split('-').map(Number);
    const startDate = new Date(year, month - 1, day - (daysBack - 1));
    const startDateStr = startDate.toLocaleDateString('en-CA');

    // For short lookbacks (<=7 days), query per-date for accuracy
    // For longer lookbacks, use date range comparison for efficiency
    const useDateRange = daysBack > 7;

    if (input.type === 'food' || input.type === 'all') {
      let foodLogs: any[];
      if (useDateRange) {
        const ref = firestore.collection(`users/${input.userId}/food_log`);
        const snapshot = await ref
          .where('date', '>=', startDateStr)
          .where('date', '<=', input.localDate)
          .limit(200)
          .get();
        foodLogs = snapshot.docs
          .map(d => ({ ...d.data(), id: d.id }))
          .filter((e: any) => !e.ignored);
      } else {
        foodLogs = [];
        for (let i = 0; i < daysBack; i++) {
          const d = new Date(year, month - 1, day - i);
          const entries = await healthService.queryFoodLog(firestore, input.userId, d.toLocaleDateString('en-CA'), 20);
          foodLogs.push(...entries);
        }
      }
      // Group by date so the AI can clearly distinguish days
      const foodByDate: Record<string, any[]> = {};
      for (const entry of foodLogs) {
        const d = entry.date || 'unknown';
        if (!foodByDate[d]) foodByDate[d] = [];
        foodByDate[d].push(entry);
      }
      results.foodByDate = foodByDate;
      results.todayFood = foodByDate[input.localDate] || [];
      results.todayProteinTotal = results.todayFood.reduce((sum: number, e: any) => sum + (e.proteinG || 0), 0);
      results.todayCalorieTotal = results.todayFood.reduce((sum: number, e: any) => sum + (e.calories || 0), 0);
    }

    if (input.type === 'exercise' || input.type === 'all') {
      let exerciseLogs: any[];
      if (useDateRange) {
        const ref = firestore.collection(`users/${input.userId}/exercise_log`);
        const snapshot = await ref
          .where('date', '>=', startDateStr)
          .where('date', '<=', input.localDate)
          .limit(200)
          .get();
        exerciseLogs = snapshot.docs
          .map(d => ({ ...d.data(), id: d.id }))
          .filter((e: any) => !e.ignored);
      } else {
        exerciseLogs = [];
        for (let i = 0; i < daysBack; i++) {
          const d = new Date(year, month - 1, day - i);
          const entries = await healthService.queryExerciseLog(firestore, input.userId, d.toLocaleDateString('en-CA'), 20);
          exerciseLogs.push(...entries);
        }
      }
      // Group by date
      const exerciseByDate: Record<string, any[]> = {};
      for (const entry of exerciseLogs) {
        const d = entry.date || 'unknown';
        if (!exerciseByDate[d]) exerciseByDate[d] = [];
        exerciseByDate[d].push(entry);
      }
      results.exerciseByDate = exerciseByDate;
      results.todayExercise = exerciseByDate[input.localDate] || [];
      results.todayPointsTotal = results.todayExercise.reduce((sum: number, e: any) => sum + (e.pointsDelta || 0), 0);
    }

    results.queryDate = input.localDate;
    results.daysQueried = daysBack;
    return results;
  }
);

const scoreDailyVFTool = ai.defineTool(
  {
    name: 'score_daily_vf',
    description: `Calculates today's Visceral Fat score using the 5-rule scoring engine. Call this at end-of-day or when the user asks for their daily score. The tool aggregates food logs to determine alcohol intake, seed oil meals, and calorie totals, then applies: (1) caloric deficit base score, (2) fasting multiplier, (3) alcohol freeze, (4) cortisol tax, (5) seed oil penalty. Returns the score and a plain-english breakdown.`,
    inputSchema: z.object({
      userId: z.string(),
      localDate: z.string().describe('YYYY-MM-DD'),
      fastingHours: z.number().describe('Consecutive clean fasting hours for the day (0 if no fasting protocol)'),
      sleepHours: z.number().describe('Hours of sleep last night'),
    }),
    outputSchema: z.object({
      score: z.number(),
      summary: z.string(),
      newEquity: z.number(),
    }),
  },
  async (input) => {
    const firestore = getAdminFirestore();

    // Gather day's food logs to compute totals
    const foodLogs = await healthService.queryFoodLog(firestore, input.userId, input.localDate, 50);
    const totalCaloriesIn = foodLogs.reduce((s, e) => s + (e.calories || 0), 0);
    const totalProteinG = foodLogs.reduce((s, e) => s + (e.proteinG || 0), 0);
    const totalAlcoholDrinks = foodLogs.reduce((s, e) => s + ((e as any).alcoholDrinks || 0), 0);
    const seedOilMeals = foodLogs.filter((e) => (e as any).hasSeedOils === true).length;

    // Get current health data for caloriesOut and existing equity
    const health = await healthService.getHealthSummary(firestore, input.userId);
    const caloriesOut = health?.dailyCaloriesOut || 2000;
    const currentEquity = health?.visceralFatPoints || 0;

    // Get protein goal from preferences
    const prefs = await healthService.getUserPreferences(firestore, input.userId);
    const proteinGoal = prefs?.targets?.proteinGoal ?? 150;

    const result = calculateDailyVFScore({
      caloriesIn: totalCaloriesIn,
      caloriesOut: caloriesOut,
      proteinG: totalProteinG,
      proteinGoal,
      fastingHours: input.fastingHours,
      alcoholDrinks: totalAlcoholDrinks,
      sleepHours: input.sleepHours,
      seedOilMeals,
    });

    // Apply score to equity
    const newEquity = currentEquity + result.score;
    await healthService.updateHealthData(firestore, input.userId, { visceralFatPoints: newEquity });

    // Record equity event with full breakdown for the day-detail view
    await healthService.recordEquityEvent(firestore, input.userId, {
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      isoDate: input.localDate,
      gain: result.score,
      status: result.score >= 0 ? 'Bullish' : 'Correction',
      detail: result.summary,
      equity: newEquity,
      breakdown: {
        caloriesIn: totalCaloriesIn,
        caloriesOut: caloriesOut,
        proteinG: totalProteinG,
        proteinGoal,
        fastingHours: input.fastingHours,
        alcoholDrinks: totalAlcoholDrinks,
        sleepHours: input.sleepHours,
        seedOilMeals,
        ...result.breakdown,
      },
    });

    return { score: result.score, summary: result.summary, newEquity };
  }
);

const ignoreLogEntryTool = ai.defineTool(
  {
    name: 'ignore_log_entry',
    description: 'Flags a food or exercise log entry as ignored (soft-delete) or restores it. Ignored entries are excluded from daily totals but preserved for audit trail. Use when the user says they logged something by mistake, wants to remove a duplicate, or needs to correct an entry. Call get_recent_logs first to find the entry ID, then call this tool with that ID.',
    inputSchema: z.object({
      userId: z.string(),
      entryId: z.string().describe('The Firestore document ID of the entry'),
      type: z.enum(['food', 'exercise']),
      ignored: z.boolean().describe('true to ignore the entry, false to restore it'),
      localDate: z.string().describe('YYYY-MM-DD — the date of the entry'),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    const firestore = getAdminFirestore();

    if (input.type === 'food') {
      const entry = await healthService.setFoodEntryIgnored(firestore, input.userId, input.entryId, input.ignored);
      if (!entry) return 'Entry not found — it may have already been removed.';

      // Recalculate today's totals from all non-ignored food entries
      const current = await healthService.getHealthSummary(firestore, input.userId);
      const isToday = current?.lastActiveDate === input.localDate;
      if (isToday) {
        const activeFoodLogs = await healthService.queryFoodLog(firestore, input.userId, input.localDate, 50);
        const newProtein = activeFoodLogs.reduce((s, e) => s + (e.proteinG || 0), 0);
        const newCarbs = activeFoodLogs.reduce((s, e) => s + (e.carbsG || 0), 0);
        const newCalories = activeFoodLogs.reduce((s, e) => s + (e.calories || 0), 0);
        await healthService.updateHealthData(firestore, input.userId, {
          dailyProteinG: newProtein,
          dailyCarbsG: newCarbs,
          dailyCaloriesIn: newCalories,
        });
        const action = input.ignored ? 'Ignored' : 'Restored';
        return `${action} "${entry.name}". Recalculated today's totals -> Protein: ${newProtein}g, Carbs: ${newCarbs}g, Calories: ${newCalories}.`;
      }

      const action = input.ignored ? 'Ignored' : 'Restored';
      return `${action} "${entry.name}" from ${input.localDate}. (Not today, so daily counters unchanged.)`;
    }

    if (input.type === 'exercise') {
      const entry = await healthService.setExerciseEntryIgnored(firestore, input.userId, input.entryId, input.ignored);
      if (!entry) return 'Entry not found — it may have already been removed.';

      // Recalculate equity from all non-ignored exercise entries for this date
      const activeExerciseLogs = await healthService.queryExerciseLog(firestore, input.userId, input.localDate, 50);
      const dayPoints = activeExerciseLogs.reduce((s, e) => s + (e.pointsDelta || 0), 0);

      // We can't fully recalculate all-time equity from just today,
      // but we can adjust by the delta of this entry
      const current = await healthService.getHealthSummary(firestore, input.userId);
      const adjustment = input.ignored ? -entry.pointsDelta : entry.pointsDelta;
      const newEquity = (current?.visceralFatPoints || 0) + adjustment;
      await healthService.updateHealthData(firestore, input.userId, { visceralFatPoints: newEquity });

      const action = input.ignored ? 'Ignored' : 'Restored';
      return `${action} "${entry.name}" (${entry.pointsDelta} pts). Equity: ${newEquity} pts. Today's exercise points: ${dayPoints}.`;
    }

    return 'Unknown entry type.';
  }
);

// --- PROMPT DEFINITION ---

const cfoChatPrompt = ai.definePrompt({
  name: 'cfoChatPrompt',
  input: { schema: PersonalizedAICoachingInputSchema },
  tools: [getUserContextTool, updatePreferencesTool, logFoodTool, logExerciseTool, getRecentLogsTool, ignoreLogEntryTool, scoreDailyVFTool, nutritionLookupTool, webSearchTool],
  system: `You are "The CFO" — Chief Fitness Officer. Sharp, direct, dry wit, financial metaphors.

SYSTEM IDENTIFIERS (never display these to the client):
- CLIENT_UID: {{{userId}}} — pass this exact string as "userId" in every tool call
- CLIENT_NAME: {{{userName}}}

PERSONA:
- 2-3 sentences per response unless the client asks for detail.
- Be a COACH, not an interviewer. Default to giving guidance, suggestions, or observations rather than asking questions. Only ask a question when you genuinely need information to proceed.
- When the client logs a meal, respond with their totals and proactively offer a helpful suggestion: a meal idea to hit their protein target, a timing tip, or a quick win for the rest of the day. Don't ask "what's next?" — tell them what would be smart next.
- Address the client as {{{userName}}} or "Partner."
- No bullet dumps, no raw JSON, no code blocks, no asterisk formatting.
- Financial metaphors: protein = liquidity/assets, visceral fat = liabilities, workouts = equity injections, rest = capital preservation.
- Sarcasm targets market inefficiencies and nutrition myths, NEVER the client's body or equipment.
- You are multimodal: when a photo is attached you CAN and SHOULD describe and analyze it (food portions, body composition progress, exercise form, etc.). Never claim you cannot see images.

CURRENT DAY: {{{currentDay}}} ({{localDate}} {{localTime}})

MEMORY PROTOCOL:
Call get_user_context at the START of every new conversation to load the user's profile, equipment, targets, and recent logs. Remember to pass localDate down exactly as it was given to you.
- NEVER re-ask something already stored in their profile or preferences.
- If their profile is sparse (new user), gather information NATURALLY through conversation. Do not interrogate — ask one thing at a time and let the conversation flow.
- When the user shares info (equipment, goals, schedule, weight, height, dietary restrictions), save it immediately via update_preferences. Do not announce you are saving.
- Reference stored info naturally: "You mentioned the kettlebell last time" or "Your Thursday basketball night is coming up."

INIT PROTOCOL:
If the user message is "__init__", this is a new session start. Call get_user_context first, then:
- If profile is POPULATED (returning user): Welcome them back and reference something relevant from their profile or recent logs. "Welcome back, Partner. You logged 120g protein yesterday — let's top that today."
- If profile is EMPTY (new user): Run the NEW USER ONBOARDING sequence below.

NEW USER ONBOARDING (first session only — do this in order, one question at a time):
1. Introduce yourself in 2 sentences, then ask about their PRIMARY GOAL. Example: "Hi, I'm your Chief Fitness Officer — I'll build a custom scoring system tied to your body and schedule. First question: what's the main thing you're after right now?"
   - If they're unsure or say they don't know, suggest: "A lot of people I work with are going for fat loss without losing muscle — ideally putting some on. That's a strong starting position. Is that in the right direction for you?"
2. After they share a goal, explain the scoring system BEFORE asking anything else: "Here's how this works: I'll design a daily point system built around your life — every workout, protein target hit, or solid night of sleep earns you points. The score compounds over time and shows whether your body is actually changing. It turns the vague feeling of 'am I making progress?' into a number. Now a couple of quick questions so I can make it personal..."
3. Then naturally gather, one question at a time:
   - What their weekly exercise looks like (frequency, type — running, lifting, sports, etc.)
   - What equipment or gear they actually have access to (home, gym, rings, kettlebells, jump rope, bodyweight only, etc.) — frame it as: "What do you have to work with? Gym membership, home setup, or just bodyweight?"
   - Any dietary preferences or restrictions worth knowing about

CONVERSATION FLOW (new users — gather info naturally, not as a checklist):
Do NOT treat these as a rigid sequence. If the user volunteers multiple pieces of info at once, save them all and move on. If they want to start logging immediately, let them — you can gather profile info over multiple sessions.
When you have enough info to set meaningful targets, save them and start coaching. There is no "onboarding complete" gate.

RESEARCH PROTOCOL:
- Client mentions a food -> use your built-in nutrition knowledge to estimate macros for common whole foods (eggs, chicken, bread, rice, fruits, vegetables, dairy, etc.). Call nutrition_lookup ONLY for specialty, branded, or restaurant items you are genuinely uncertain about. Never block logging on an API call for foods you already know well.
- Log the whole meal as one log_food entry (summed macros) rather than one call per ingredient.
- Client asks about exercise science, supplements, gear, or recovery -> call web_search.
  Cite the source in your reply.
- Do not mention you are searching or looking things up. Deliver results as confident CFO statements.
- When calling get_recent_logs, always pass localDate ({{localDate}}) so dates are correct for the client's timezone.

CONSUMPTION TIME:
- When logging food via log_food, ALWAYS set consumedAt (HH:MM, 24h format). Infer from context: "I had lunch at noon" -> "12:00", "just ate breakfast" -> use the current localTime. If the user says "earlier today" or "this morning", estimate reasonably.
- When logging exercise via log_exercise, ALWAYS set performedAt using the same logic.
- The ledger displays consumedAt/performedAt to the user, NOT the time of entry, so getting this right matters.

COACHING PROTOCOL:
- After calling log_food or log_exercise, report ONLY the daily totals returned by the tool. Never compute running totals from chat history — the tool has the authoritative database value and handles day resets.
- Track protein against their goal. Mention the gap naturally, then suggest a concrete way to close it: "You're 98g short — a chicken breast and a protein shake at lunch would nearly close that gap."
- When they report exercise, estimate calorie burn and log it. Reference their equipment and schedule.
- Be PROACTIVE with guidance: suggest meals, workout ideas, or recovery strategies based on what you know about their profile, equipment, and schedule. Lead with the suggestion, not a question.
- If isDeviceVerified is false and the context is right (they mention steps, sleep, HRV), mention Fitbit ONCE per session: "Your step data would be way more reliable with a Fitbit sync. Want to connect one?"
- When asked for help planning a meal or workout, give 1-2 concrete options tailored to their profile — not a menu of 5+ generic ideas.

EXERCISE HISTORY & PHYSICAL ABILITIES:
- The exercise log stores weightKg, sets, reps, durationMin, and category for every logged workout. You have FULL ACCESS to this history via get_recent_logs.
- When the user asks about their PRs, heaviest lifts, workout history, progress, or physical abilities, call get_recent_logs with type="exercise" and a sufficient lookback (days=30 for a month, days=90 for a quarter, etc.). Then analyze the data and answer their question.
- Track and celebrate progress: "You pressed 32kg kettlebells last month — up from 24kg in January. That's a 33% equity gain on overhead press."
- Never say you don't track this data or can't answer. The data is there — just query it.

VF DAILY SCORING SYSTEM (the 5 Bylaws — this is the authoritative scoring engine):
Call score_daily_vf at end-of-day or whenever the user asks "what was my VF score." The tool computes everything automatically from logged data, but you need to supply fastingHours and sleepHours from the conversation.

Rule 1 — The Caloric Engine: Base score from caloric deficit (max +100 at ~1,000 cal deficit). Protein mandate: cannot claim +100 unless the 150g daily protein target is met. Missing protein caps the positive score at +50.
Rule 2 — The Fasting Multiplier: A 24+ hour clean fast = automatic +100, bypassing calorie math entirely. 100% of energy comes from stored body fat.
Rule 3 — The Alcohol Freeze: >2 alcoholic drinks caps the maximum daily score at 0 (fat oxidation halted). If the alcohol also pushes into caloric surplus, penalty drops to -100 to -200.
Rule 4 — The Cortisol Tax: <6 hours of sleep halves any positive score. A +100 deficit day becomes +50 because cortisol hoards visceral fat.
Rule 5 — The Seed Oil Penalty: Each meal heavily processed or deep-fried in industrial seed oils (soybean, canola, sunflower) deducts -25 "Inflammation Tax."

When logging food (log_food), ALWAYS assess and set:
- alcoholDrinks: count of alcoholic beverages in the meal (beer/wine/cocktail = 1 each)
- hasSeedOils: true if the meal is deep-fried, heavily processed, or cooked in seed oils (typical bar food, fast food, packaged snacks)

The MOST PROFITABLE days combine: caloric deficit + 150g protein + fasting protocol + zero alcohol + 8h sleep + no seed oils.

EXERCISE STILL MATTERS for calorie burn (caloriesOut) and muscle building, but exercise alone does NOT directly add VF points. Exercise increases the caloric deficit which feeds Rule 1. Log exercise via log_exercise to track workouts and estimate calorie burn.

When the user asks about scoring rules, explain them conversationally using financial metaphors. If they ask about the science behind any rule (e.g., "why does alcohol freeze fat burning?"), use web_search to find authoritative sources and cite them.

CORRECTIONS & MISTAKES:
- If the user says they logged something by mistake, wants to remove an entry, or correct a duplicate, call get_recent_logs first to find the entry and its ID, then call ignore_log_entry with ignored=true. The entry stays in the database for audit trail but is excluded from all totals.
- After ignoring, report the recalculated daily totals from the tool response.
- If the user wants to correct an entry (wrong portion, wrong food), ignore the old one first, then log the corrected version.
- If the user changes their mind, call ignore_log_entry with ignored=false to restore it.
- Confirm what you are ignoring before doing it: "I'll strike the '2 eggs' entry from breakfast — that right?"

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

{{#if photoDataUri}}
[The user has attached a photo — you CAN see it. Describe relevant details (food, body composition, exercise form, progress pic, etc.) and use them directly in your coaching response.]
{{media url=photoDataUri}}
{{/if}}
New message from {{{userName}}}: {{{message}}}`,
});

export async function personalizedAICoaching(input: PersonalizedAICoachingInput): Promise<PersonalizedAICoachingOutput> {
  const result = await cfoChatPrompt(input, { maxTurns: 15 });
  return { response: result.text ?? 'Something went wrong. Try again.' };
}

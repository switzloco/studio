import type { Firestore } from 'firebase-admin/firestore';
import { adminHealthService as healthService } from '@/lib/health-service-admin';
import { computeAlpertNumber } from '@/lib/vf-scoring';
import { runMetabolicSimulation, computeMuscleGlycogenMaxKcal, NUM_SLOTS } from '@/lib/metabolic-engine';

export interface SlimUserContext {
  today: string;
  yesterday: string;
  preferences: any;
  health: any;
  fitbitSync: any;
  todaysFoodLog: any[];
  todaysExerciseLog: any[];
  todaysFitbitActivities: any[];
  yesterdaysFoodLog: any[];
  yesterdaysFoodCount: number;
  yesterdaysProteinTotal: number;
  yesterdaysCalorieTotal: number;
  foodNicknamesIndex: Record<string, string>;
  recentFasts: any[];
  activeFast: any;
  temporaryContext: any;
  alpertPace: any;
  glycogenState: any;
}

export async function fetchSlimUserContext(firestore: Firestore, userId: string, today: string): Promise<SlimUserContext> {
  const [y, m, d] = today.split('-').map(Number);
  const yesterdayDate = new Date(y, m - 1, d - 1);
  const yesterday = yesterdayDate.toLocaleDateString('en-CA');

  const [prefs, health, recentFood, recentExercise, yesterdayFood, fitbitCreds, recentFasts] = await Promise.all([
    healthService.getUserPreferences(firestore, userId),
    healthService.getHealthSummary(firestore, userId),
    healthService.queryFoodLog(firestore, userId, today, 10),
    healthService.queryExerciseLog(firestore, userId, today, 10),
    healthService.queryFoodLog(firestore, userId, yesterday, 10),
    healthService.getFitbitCredentials(firestore, userId),
    healthService.queryFastLogRange(firestore, userId, yesterday, today, 10),
  ]);

  const isNewDay = health?.lastActiveDate !== today;

  const fitbitStatus: {
    connected: boolean;
    lastSyncedAt?: number;
    lastSyncedAgo?: string;
    tokenExpired?: boolean;
  } = { connected: false };
  if (fitbitCreds) {
    fitbitStatus.connected = true;
    fitbitStatus.lastSyncedAt = fitbitCreds.lastSyncedAt;
    fitbitStatus.tokenExpired = Date.now() >= fitbitCreds.expiresAt;
    if (fitbitCreds.lastSyncedAt) {
      const hoursAgo = Math.round((Date.now() - fitbitCreds.lastSyncedAt) / (1000 * 60 * 60));
      fitbitStatus.lastSyncedAgo = hoursAgo <= 1 ? 'just now' : `${hoursAgo}h ago`;
    }
  }

  // Build compact index: key -> meal
  const foodNicknamesIndex: Record<string, string> = {};
  if (prefs?.foodNicknames) {
    for (const [key, val] of Object.entries(prefs.foodNicknames)) {
      foodNicknamesIndex[key] = val?.meal || 'snack';
    }
  }

  // Omit full recipe objects from preferences payload
  const slimPrefs = prefs ? { ...prefs, foodNicknames: undefined } : null;

  return {
    today,
    yesterday,
    preferences: slimPrefs,
    health: {
      dailyProteinG: isNewDay ? 0 : (health?.dailyProteinG ?? 0),
      dailyCaloriesIn: isNewDay ? 0 : (health?.dailyCaloriesIn ?? 0),
      dailyCarbsG: isNewDay ? 0 : (health?.dailyCarbsG ?? 0),
      visceralFatPoints: health?.visceralFatPoints ?? 0,
      isDeviceVerified: health?.isDeviceVerified ?? false,
      steps: health?.steps ?? 0,
      weightKg: health?.weightKg,
      heightCm: health?.heightCm,
      bodyFatPct: health?.bodyFatPct,
    },
    fitbitSync: fitbitStatus,
    todaysFoodLog: recentFood,
    todaysExerciseLog: recentExercise,
    todaysFitbitActivities: health?.fitbitByDate?.[today]?.activities ?? [],
    yesterdaysFoodLog: yesterdayFood,
    yesterdaysFoodCount: yesterdayFood.length,
    yesterdaysProteinTotal: yesterdayFood.reduce((s, e) => s + (e.proteinG || 0), 0),
    yesterdaysCalorieTotal: yesterdayFood.reduce((s, e) => s + (e.calories || 0), 0),
    foodNicknamesIndex,
    recentFasts,
    activeFast: recentFasts.find(f => !f.endedAt) || null,
    temporaryContext: (() => {
      const tc = prefs?.temporaryContext;
      if (!tc) return null;
      if (tc.expiresAt < today) return null;
      return tc;
    })(),
    alpertPace: (() => {
      const caloriesIn = isNewDay ? 0 : (health?.dailyCaloriesIn ?? 0);
      const caloriesOut = health?.dailyCaloriesOut ?? 0;
      const deficit = caloriesOut - caloriesIn;
      if (caloriesIn <= 0 || caloriesOut <= 0 || deficit <= 0) return null;
      const alpert = computeAlpertNumber(health?.weightKg, health?.bodyFatPct);
      const now = new Date();
      const hoursElapsed = now.getHours() + now.getMinutes() / 60;
      if (hoursElapsed < 4) return null;

      const isCriticalDeficit = deficit >= alpert * 0.9;
      const currentRate = Math.round(deficit / hoursElapsed);
      const projectedDaily = Math.round(currentRate * 24);
      const isLateDayBreach = hoursElapsed >= 17 && 
                              projectedDaily >= alpert * 1.3 && 
                              deficit >= alpert * 0.75;

      if (!isCriticalDeficit && !isLateDayBreach) return null;

      const hourlyBudget = Math.round(alpert / 24);
      return { alpertNumber: alpert, currentHourlyRate: currentRate, hourlyBudget, projectedDailyDeficit: projectedDaily, breaching: true };
    })(),
    glycogenState: (() => {
      const caloriesOut = health?.dailyCaloriesOut ?? 0;
      if (caloriesOut <= 0) return null;
      const wKg = health?.weightKg;
      const bfPct = health?.bodyFatPct;
      const muscleMax = computeMuscleGlycogenMaxKcal(wKg, bfPct);
      const alpert    = computeAlpertNumber(wKg, bfPct);
      const todayFitbitActivities = health?.fitbitByDate?.[today]?.activities;
      const sim = runMetabolicSimulation({
        caloriesOut,
        alpertNumber: alpert,
        foodLogs:         isNewDay ? [] : (recentFood ?? []),
        exerciseLogs:     isNewDay ? [] : (recentExercise ?? []),
        fitbitActivities: isNewDay ? [] : (todayFitbitActivities ?? []),
        caloriesIn:       isNewDay ? 0  : (health?.dailyCaloriesIn ?? 0),
        muscleGlycogenMaxKcal: muscleMax,
      });
      const now = new Date();
      const nowMin  = now.getHours() * 60 + now.getMinutes();
      const nowSlot = Math.max(0, Math.min(NUM_SLOTS - 1,
        Math.round((nowMin - 6 * 60) / 15)));
      const snap = sim.slots[nowSlot];
      const musclePct = Math.round((snap.muscleGlycogenKcal / muscleMax) * 100);
      const liverPct  = Math.round((snap.liverKcal / 400) * 100);

      const activeEx = (recentExercise ?? []).filter(e => !e.ignored);
      let hoursPostExercise: number | null = null;
      if (activeEx.length > 0) {
        const last = activeEx[activeEx.length - 1];
        if (last.performedAt) {
          const [eh, em] = last.performedAt.split(':').map(Number);
          const endMin = eh * 60 + (em || 0) + (last.durationMin || 30);
          hoursPostExercise = Math.round(((nowMin - endMin) / 60) * 10) / 10;
        }
      }
      if (todayFitbitActivities && todayFitbitActivities.length > 0) {
        const lastFit = todayFitbitActivities[todayFitbitActivities.length - 1];
        const [sh, sm] = lastFit.startTime.split(':').map(Number);
        const fitEndMin = sh * 60 + (sm || 0) + lastFit.durationMin;
        const fitHoursPost = Math.round(((nowMin - fitEndMin) / 60) * 10) / 10;
        if (hoursPostExercise === null || (fitHoursPost >= 0 && fitHoursPost < hoursPostExercise)) {
          hoursPostExercise = fitHoursPost;
        }
      }

      const depleted = musclePct < 50;
      const inRefuelWindow = hoursPostExercise !== null && hoursPostExercise >= 0 && hoursPostExercise <= 2;
      const refuelCarbsG = wKg ? Math.round(wKg * 1.2) : null;
      const muscleDeficitKcal = muscleMax - snap.muscleGlycogenKcal;
      const muscleDeficitG    = Math.round(muscleDeficitKcal / 4);

      return {
        muscleKcal:        snap.muscleGlycogenKcal,
        muscleMax,
        musclePct,
        liverKcal:         snap.liverKcal,
        liverPct,
        depleted,
        inRefuelWindow,
        hoursPostExercise,
        refuelCarbsG,
        muscleDeficitG,
      };
    })(),
  };
}

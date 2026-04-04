/**
 * @fileOverview Visceral Fat daily scoring engine.
 *
 * SCORING: Hourly Metabolic Partitioning (4-bucket sequential drain).
 *   Score = (totalFatBurned / 1200) × 100
 *         − (totalFatStored  / 1200) × 100
 *         − (totalMuscleLost / 10)   × 2
 *
 *   1200 kcal = PSMF perfect-day baseline (physiologically optimal fat-loss day).
 *   Score is UNCAPPED — extended fasts score > 100. Caloric surplus scores < 0.
 *
 *   Fat faucet is PAUSED while gut has food (insulin suppression of lipolysis).
 *   Fat oxidation is rate-limited to alpertNumber/24 kcal/hr.
 *   Alpert number = fat mass (lbs) × 31 kcal/lb/day  [Alpert 2005]
 *
 * 5-RULE ASSESSMENTS (coaching context, not scoring):
 *   Rule 1 — Caloric Engine    (base deficit context)
 *   Rule 2 — Fasting Multiplier
 *   Rule 3 — Alcohol Freeze
 *   Rule 4 — Cortisol Tax
 *   Rule 5 — Seed Oil Penalty
 */

import type { FoodLogEntry, ExerciseLogEntry } from './food-exercise-types';
import type { FitbitActivity } from './health-service';
import { runMetabolicSimulation, computeMetabolicScore } from './metabolic-engine';

/** Compute maximum sustainable fat oxidation in kcal/day (Alpert 2005). */
export function computeAlpertNumber(weightKg?: number, bodyFatPct?: number): number {
  const kg = weightKg ?? 68;           // ~150 lbs default
  const bfFraction = bodyFatPct != null ? bodyFatPct / 100 : 0.25;
  const fatMassLbs = kg * bfFraction * 2.20462;
  return Math.round(Math.max(500, fatMassLbs * 31)); // floor at 500 to avoid div-by-zero extremes
}

export interface DailyVFInput {
  caloriesIn: number;
  caloriesOut: number;
  proteinG: number;
  proteinGoal: number;       // typically 150
  fastingHours: number;      // consecutive clean fast hours for the day
  alcoholDrinks: number;     // number of alcoholic drinks consumed
  sleepHours: number;
  seedOilMeals: number;      // count of meals with heavy seed oil / deep-fried
  weightKg?: number;         // used for Alpert number calculation
  bodyFatPct?: number;       // 0-100; used for Alpert number calculation
  // Optional: per-entry logs for precise slot simulation
  foodLogs?: FoodLogEntry[];
  exerciseLogs?: ExerciseLogEntry[];
  fitbitActivities?: FitbitActivity[];
}

export interface DailyVFResult {
  score: number;
  breakdown: {
    // Metabolic engine outputs
    alpertNumber: number;
    deficit: number;
    totalFatBurned: number;
    totalFatStored: number;
    muscleKcal: number;
    // Coaching context (rule assessments)
    proteinMet: boolean;
    fastingActive: boolean;
    alcoholFlag: boolean;
    poorSleep: boolean;
    seedOilMeals: number;
    // Legacy fields kept for backward compatibility with old history entries
    baseScore?: number;
    fastingOverride?: boolean;
    alcoholCap?: boolean;
    alcoholPenalty?: number;
    cortisolMultiplier?: number;
    seedOilPenalty?: number;
  };
  summary: string;
}

export function calculateDailyVFScore(input: DailyVFInput): DailyVFResult {
  const {
    caloriesIn,
    caloriesOut,
    proteinG,
    proteinGoal,
    fastingHours,
    alcoholDrinks,
    sleepHours,
    seedOilMeals,
    weightKg,
    bodyFatPct,
    foodLogs,
    exerciseLogs,
    fitbitActivities,
  } = input;

  const alpertNumber = computeAlpertNumber(weightKg, bodyFatPct);
  const deficit = caloriesOut - caloriesIn;

  // Run the metabolic simulation when logs available, else approximate from daily totals
  let totalFatBurned: number;
  let totalFatStored: number;
  let muscleKcal: number;
  let score: number;

  if (foodLogs && foodLogs.length > 0) {
    const result = runMetabolicSimulation({
      caloriesOut,
      alpertNumber,
      foodLogs,
      exerciseLogs,
      fitbitActivities,
      caloriesIn,
    });
    totalFatBurned = result.totalFatBurned;
    totalFatStored = result.totalFatStored;
    muscleKcal     = result.totalMuscleLost;
    score          = result.score;
  } else {
    // Daily-total approximation: treat all deficit as fat burned (no timing data)
    totalFatBurned = Math.max(0, deficit);
    totalFatStored = Math.max(0, -deficit);
    muscleKcal     = 0;
    score          = computeMetabolicScore(totalFatBurned, totalFatStored, muscleKcal);
  }

  // --- Coaching context assessments (informational only) ---
  const proteinMet   = proteinG >= proteinGoal;
  const fastingActive = fastingHours >= 16;
  const alcoholFlag  = alcoholDrinks > 2;
  const poorSleep    = sleepHours < 6;

  // Build summary
  const directionLabel = deficit >= 0 ? 'deficit' : 'surplus';
  const parts: string[] = [
    `${Math.abs(deficit)} kcal ${directionLabel}; fat burned ${totalFatBurned} kcal, stored ${totalFatStored} kcal, muscle ${muscleKcal} kcal → ${score} pts`,
  ];
  if (!proteinMet) parts.push(`protein short (${proteinG}/${proteinGoal}g)`);
  if (fastingActive) parts.push(`${fastingHours}h fast`);
  if (alcoholFlag) parts.push(`${alcoholDrinks} drinks — liver overhead`);
  if (poorSleep) parts.push(`<6h sleep — cortisol elevated`);
  if (seedOilMeals > 0) parts.push(`${seedOilMeals} seed-oil meal(s) — inflammation load`);

  return {
    score,
    breakdown: {
      alpertNumber,
      deficit,
      totalFatBurned,
      totalFatStored,
      muscleKcal,
      proteinMet,
      fastingActive,
      alcoholFlag,
      poorSleep,
      seedOilMeals,
    },
    summary: `Daily VF score: ${score}. ${parts.join('; ')}.`,
  };
}

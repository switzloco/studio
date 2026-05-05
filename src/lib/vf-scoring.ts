/**
 * @fileOverview Visceral Fat daily scoring engine.
 *
 * SCORING: Linear caloric-deficit base + biology-grounded modifiers.
 *   Base  = deficit / 10   (1000 kcal deficit = 100 pts)
 *   Range = [-200 … uncapped positive]
 *
 *   Metabolic engine (4-bucket drain) still runs for informational breakdown
 *   but does NOT drive the score — it was producing extreme negatives on
 *   fasting days due to Alpert rate-limiting forcing deficit into muscle.
 *
 * 5 BIOLOGY-BASED MODIFIERS:
 *   1 — Caloric Engine    (base = deficit / 10; cap +50 if protein missed)
 *   2 — Fasting Override  (24h+ fast → +100 base — ketosis is protective)
 *   3 — Alcohol Drag      (−5 pts/drink — ~1h suppressed fat oxidation each)
 *   4 — Cortisol Tax      (sleep <6h → 0.8× positive scores — ~20% impairment)
 *   5 — Seed Oil Nudge    (−5 pts/meal — mild inflammation signal, not acute)
 */

import type { FoodLogEntry, ExerciseLogEntry } from './food-exercise-types';
import type { FitbitActivity } from './health-service';
import { runMetabolicSimulation, computeMetabolicScore, computeMuscleGlycogenMaxKcal } from './metabolic-engine';

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
  hrv?: number;              // 0-150; used for recovery multiplier
  hasCreatine?: boolean;     // user supplement status
  // Optional: per-entry logs for precise slot simulation
  foodLogs?: FoodLogEntry[];
  exerciseLogs?: ExerciseLogEntry[];
  fitbitActivities?: FitbitActivity[];
}

export interface DailyVFResult {
  score: number;
  breakdown: {
    // Metabolic engine outputs (informational)
    alpertNumber: number;
    deficit: number;
    totalFatBurned: number;
    totalFatStored: number;
    muscleKcal: number;
    // Coaching context (rule assessments)
    proteinMet: boolean;
    fastingActive: boolean;
    alcoholFlag: boolean;
    seedOilMeals: number;
    // Rule modifier fields
    baseScore: number;
    fastingOverride: boolean;
    alcoholCap: boolean;
    alcoholPenalty: number;
    hrvMultiplier: number;
    hrvStatus: 'tax' | 'neutral' | 'bonus';
    omega3Bonus: number;
    seedOilPenalty: number;
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

  // Run metabolic simulation for breakdown detail (informational display only)
  let totalFatBurned: number;
  let totalFatStored: number;
  let muscleKcal: number;

  if (foodLogs && foodLogs.length > 0) {
    const result = runMetabolicSimulation({
      caloriesOut,
      alpertNumber,
      foodLogs,
      exerciseLogs,
      fitbitActivities,
      caloriesIn,
      muscleGlycogenMaxKcal: computeMuscleGlycogenMaxKcal(weightKg, bodyFatPct),
    });
    totalFatBurned = result.totalFatBurned;
    totalFatStored = result.totalFatStored;
    muscleKcal     = result.totalMuscleLost;
  } else {
    // Daily-total approximation: treat all deficit as fat burned (no timing data)
    totalFatBurned = Math.max(0, deficit);
    totalFatStored = Math.max(0, -deficit);
    muscleKcal     = 0;
  }

  // ── Rule assessments ──────────────────────────────────────────────────────
  const proteinMet    = proteinG >= proteinGoal;
  const fastingActive = fastingHours >= 16;
  const alcoholFlag   = alcoholDrinks > 2;

  // Rule 2: Fasting Override — 24h+ fast OR calorie intake <15% of TDEE.
  const nearFasting = caloriesIn >= 0 && caloriesIn < caloriesOut * 0.15;
  const fastingOverride = fastingHours >= 24 || nearFasting;

  // Rule 1: Base score from caloric deficit
  const baseScore = fastingOverride ? 100 : Math.round(deficit / 10);
  let score = baseScore;

  if (!proteinMet && !fastingOverride && score > 0) {
    const proteinRatio = Math.min(1, proteinG / proteinGoal);
    score = Math.round(score * proteinRatio);
  }

  // Rule 3: Alcohol Drag
  // Up to 3 drinks: -5 pts/drink (oxidation suppression).
  // 4+ drinks: -10 pts/drink (toxic load & severe liver overhead).
  const alcoholPenalty = alcoholDrinks > 3 
    ? (3 * -5) + ((alcoholDrinks - 3) * -10)
    : alcoholDrinks * -5;
  score += alcoholPenalty;

  // Rule 4: HRV Multiplier (Replacing Sleep/Cortisol tax)
  let hrvMultiplier = 1.0;
  let hrvStatus: 'tax' | 'neutral' | 'bonus' = 'neutral';
  if (input.hrv) {
    if (input.hrv < 30) {
      hrvMultiplier = 0.85;
      hrvStatus = 'tax';
    } else if (input.hrv > 80) {
      hrvMultiplier = 1.10;
      hrvStatus = 'bonus';
    }
  }
  
  if (score > 0) {
    score = Math.round(score * hrvMultiplier);
  }

  // Rule 5: Omega-3 Sensitivity Bonus
  // Moderate chronic effect on insulin sensitivity; acknowledged as a minor "lubricant" for fat oxidation.
  let omega3Bonus = 0;
  if (input.foodLogs) {
    const totalO3 = input.foodLogs.reduce((sum, f) => sum + (f.omega3Mg || 0), 0);
    if (totalO3 >= 2000) omega3Bonus = 3;
    else if (totalO3 >= 1000) omega3Bonus = 1;
  }
  score += omega3Bonus;

  // Rule 6: Seed Oil Nudge
  // Mild inflammation signal; represents systemic friction.
  const seedOilPenalty = seedOilMeals * -2;
  score += seedOilPenalty;

  // Clamp worst case at -200
  score = Math.max(-200, score);

  // ── Summary ───────────────────────────────────────────────────────────────
  const directionLabel = deficit >= 0 ? 'deficit' : 'surplus';
  const parts: string[] = [
    `${Math.abs(deficit)} kcal ${directionLabel}; fat burned ${totalFatBurned} kcal, stored ${totalFatStored} kcal → ${score} pts`,
  ];
  if (!proteinMet) parts.push(`protein short (${proteinG}/${proteinGoal}g)`);
  if (fastingActive) parts.push(`${fastingHours}h fast`);
  if (alcoholFlag) parts.push(`${alcoholDrinks} drinks — liver overhead`);
  if (hrvStatus === 'tax') parts.push(`low HRV recovery tax`);
  if (hrvStatus === 'bonus') parts.push(`high HRV recovery bonus`);
  if (omega3Bonus > 0) parts.push(`omega-3 sensitivity bonus (+${omega3Bonus})`);
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
      seedOilMeals,
      baseScore,
      fastingOverride,
      alcoholCap: false,
      alcoholPenalty,
      hrvMultiplier,
      hrvStatus,
      omega3Bonus,
      seedOilPenalty,
    },
    summary: `Daily VF score: ${score}. ${parts.join('; ')}.`,
  };
}

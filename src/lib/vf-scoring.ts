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
    poorSleep: boolean;
    seedOilMeals: number;
    // Rule modifier fields
    baseScore: number;
    fastingOverride: boolean;
    alcoholCap: boolean;
    alcoholPenalty: number;
    cortisolMultiplier: number;
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
  const poorSleep     = sleepHours < 6;

  // Rule 2: Fasting Override — 24h+ fast OR calorie intake <15% of TDEE.
  // Near-fasting days (e.g. 235 kcal in / 2700 kcal out) are treated the same
  // as an explicit fast: score caps at +100, protein mandate is waived.
  const nearFasting = caloriesIn >= 0 && caloriesIn < caloriesOut * 0.15;
  const fastingOverride = fastingHours >= 24 || nearFasting;

  // Rule 1: Base score from caloric deficit (linear: 1000 kcal deficit = 100 pts)
  // Fasting override caps at +100 to prevent runaway scores on extreme deficits.
  const baseScore = fastingOverride ? 100 : Math.round(deficit / 10);
  let score = baseScore;

  // Rule 1: Protein mandate — cap positive score at +50 if protein goal not met.
  // Waived when fasting/near-fasting: you can't eat protein you're not eating.
  if (!proteinMet && !fastingOverride && score > 50) {
    score = 50;
  }

  // Rule 3: Alcohol Drag — each drink suppresses fat oxidation ~1h (Siler 1999)
  // At typical Alpert rates, ~5 pts of lost fat-burning per drink.
  const alcoholPenalty = alcoholDrinks > 0 ? alcoholDrinks * -5 : 0;
  const alcoholCap    = false; // no cliff — proportional to biology
  score += alcoholPenalty;

  // Rule 4: Cortisol Tax — poor sleep elevates cortisol ~20%, impairing fat oxidation
  // Only penalizes positive scores (bad sleep doesn't "help" a surplus day)
  const cortisolMultiplier = poorSleep ? 0.8 : 1;
  if (poorSleep && score > 0) {
    score = Math.round(score * cortisolMultiplier);
  }

  // Rule 5: Seed Oil Nudge — mild inflammatory signal (omega-6 load)
  // Acute daily impact on fat oxidation is negligible; this is a coaching nudge.
  const seedOilPenalty = seedOilMeals * -5;
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
      baseScore,
      fastingOverride,
      alcoholCap,
      alcoholPenalty,
      cortisolMultiplier,
      seedOilPenalty,
    },
    summary: `Daily VF score: ${score}. ${parts.join('; ')}.`,
  };
}

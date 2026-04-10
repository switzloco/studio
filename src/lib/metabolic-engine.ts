/**
 * @fileOverview Hourly Metabolic Partitioning Engine
 *
 * Simulates 5-bucket sequential energy drain across 15-minute slots from 6 AM to 10 PM.
 *
 * Drain priority per slot:
 *   1. Gut / Exogenous    — food being absorbed (insulin suppresses lipolysis)
 *   2. Fat Faucet         — rate-limited at alpertNumber/24/4 per slot; PAUSED while gut non-empty
 *   3. Liver Glycogen     — 400 kcal cap; replenishes from absorbed carbs
 *   4. Muscle Glycogen    — 1500 kcal cap; primary exercise buffer; replenishes from dietary carbs
 *   5. Muscle Protein     — true last resort; contributes to score penalty
 *
 * Surplus slots (absorption > burn) → fat storage, tracked separately.
 *
 * Score = (totalFatBurned / 1200) × 100
 *       − (totalFatStored  / 1200) × 100
 *       − (totalMuscleLost / 10)   × 2
 *
 * 1200 kcal = PSMF day baseline (physiologically perfect fat-loss day).
 * Score is uncapped — extended fasts produce scores > 100.
 */

import type { FoodLogEntry, ExerciseLogEntry } from './food-exercise-types';
import type { FitbitActivity } from './health-service';

// ── Simulation constants ──────────────────────────────────────────────────────
const INTERVAL_MIN = 15;
const START_MIN    = 6 * 60;   // 6:00 AM
const END_MIN      = 22 * 60;  // 10:00 PM
export const NUM_SLOTS = Math.ceil((END_MIN - START_MIN) / INTERVAL_MIN) + 1; // 65

const ABSORPTION_SLOTS             = 6;     // 90-min food absorption window
const LIVER_MAX_KCAL               = 400;   // 100g glycogen × 4 kcal/g
const MUSCLE_GLYCOGEN_MAX_KCAL     = 1500;  // typical intramuscular glycogen capacity
export const BASELINE_KCAL         = 1200;  // PSMF perfect-day denominator
const MUSCLE_PENALTY_PER_10KCAL    = 2;     // score points lost per 10 kcal muscle burned

const MEAL_DEFAULT_MIN: Record<string, number> = {
  breakfast: 7 * 60,
  lunch:     12 * 60 + 30,
  dinner:    18 * 60 + 30,
  snack:     15 * 60,
};

const TIER_DISCOUNT: Record<string, number> = {
  tier1_walking: 1.0,
  tier2_steady_state: 0.80,
  tier3_anaerobic: 0.65,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function timeToSlot(minutesSinceMidnight: number): number {
  return Math.round((minutesSinceMidnight - START_MIN) / INTERVAL_MIN);
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface MetabolicEngineParams {
  caloriesOut: number;
  alpertNumber: number;
  foodLogs?: FoodLogEntry[];
  exerciseLogs?: ExerciseLogEntry[];
  fitbitActivities?: FitbitActivity[];
  /** Starting liver glycogen. Default: 280 kcal (70% of 400 kcal max). */
  liverGlycogenStartKcal?: number;
  /** Starting muscle glycogen. Default: 1200 kcal (~80% of typical 1500 kcal max). */
  muscleGlycogenStartKcal?: number;
  /** Fallback daily caloric intake when no foodLogs are provided. */
  caloriesIn?: number;
}

export interface MetabolicSlotData {
  slot: number;
  // Per-slot fuel source contributions (kcal)
  gutContribution: number;
  fatContribution: number;
  liverContribution: number;
  muscleContribution: number;
  fatStoredThisSlot: number;
  // Running cumulative totals
  cumulativeFatBurned: number;
  cumulativeFatStored: number;
  cumulativeMuscleLost: number;
  // Bucket levels at end of slot (for gauge visualization)
  gutKcal: number;
  liverKcal: number;
  fatAllowanceRemaining: number;
}

export interface MetabolicResult {
  slots: MetabolicSlotData[];
  totalFatBurned: number;
  totalFatStored: number;
  totalMuscleLost: number;
  score: number;
}

// ── Score formula ─────────────────────────────────────────────────────────────

export function computeMetabolicScore(
  fatBurned: number,
  fatStored: number,
  muscleLost: number,
): number {
  const fatBurnPts    = (fatBurned / BASELINE_KCAL) * 100;
  const fatStorePts   = (fatStored / BASELINE_KCAL) * 100;
  const musclePenalty = (muscleLost / 10) * MUSCLE_PENALTY_PER_10KCAL;
  return Math.round(fatBurnPts - fatStorePts - musclePenalty);
}

// ── Core simulation ───────────────────────────────────────────────────────────

export function runMetabolicSimulation(params: MetabolicEngineParams): MetabolicResult {
  const {
    caloriesOut,
    alpertNumber,
    foodLogs,
    exerciseLogs,
    fitbitActivities,
    liverGlycogenStartKcal = 280,
    muscleGlycogenStartKcal = 1200,
    caloriesIn = 0,
  } = params;

  // Max fat that can be oxidized in one 15-min slot (Alpert rate limit)
  const fatFaucetPerSlot = alpertNumber / 24 / 4;

  // ── Build per-slot absorption and gut-remaining arrays ────────────────────
  const absorptionPerSlot = new Array<number>(NUM_SLOTS).fill(0);
  const gutBySlot         = new Array<number>(NUM_SLOTS).fill(0);

  const activeFoods = foodLogs?.filter(f => !f.ignored) ?? [];

  if (activeFoods.length > 0) {
    for (const food of activeFoods) {
      const eatMin  = food.consumedAt
        ? parseHHMM(food.consumedAt)
        : (MEAL_DEFAULT_MIN[food.meal] ?? 12 * 60);
      const eatSlot = Math.max(0, Math.min(NUM_SLOTS - 1, timeToSlot(eatMin)));
      const perSlot = food.calories / ABSORPTION_SLOTS;
      for (let s = eatSlot; s < Math.min(eatSlot + ABSORPTION_SLOTS, NUM_SLOTS); s++) {
        absorptionPerSlot[s] += perSlot;
        // Gut = food not yet absorbed at start of slot s
        gutBySlot[s] += food.calories * (1 - (s - eatSlot) / ABSORPTION_SLOTS);
      }
    }
  } else if (caloriesIn > 0) {
    // Fallback: 3-meal shape when no individual logs available
    const meals = [
      { slot: timeToSlot(7 * 60),       kcal: caloriesIn * 0.25 },
      { slot: timeToSlot(12 * 60 + 30), kcal: caloriesIn * 0.35 },
      { slot: timeToSlot(18 * 60 + 30), kcal: caloriesIn * 0.40 },
    ];
    for (const m of meals) {
      const eatSlot = Math.max(0, Math.min(NUM_SLOTS - 1, m.slot));
      const perSlot = m.kcal / ABSORPTION_SLOTS;
      for (let s = eatSlot; s < Math.min(eatSlot + ABSORPTION_SLOTS, NUM_SLOTS); s++) {
        absorptionPerSlot[s] += perSlot;
        gutBySlot[s] += m.kcal * (1 - (s - eatSlot) / ABSORPTION_SLOTS);
      }
    }
  }

  // ── Build per-slot exercise burn array ────────────────────────────────────
  const exerciseBurnPerSlot = new Array<number>(NUM_SLOTS).fill(0);
  let totalExerciseCal = 0;

  const activeLogs = exerciseLogs?.filter(e => !e.ignored) ?? [];
  const logsToUse = activeLogs.length > 0
    ? activeLogs.map(ex => ({
        cal: ex.adjustedCalories || ex.estimatedCaloriesBurned || 0,
        durationMin: ex.durationMin || 30,
        startMin: ex.performedAt ? parseHHMM(ex.performedAt) : 12 * 60,
      }))
    : (fitbitActivities ?? []).map(act => ({
        cal: Math.round(act.calories * (TIER_DISCOUNT[act.activityTier] ?? 0.80)),
        durationMin: act.durationMin,
        startMin: parseHHMM(act.startTime),
      }));

  for (const ex of logsToUse) {
    if (ex.cal <= 0) continue;
    const dur       = Math.max(15, ex.durationMin);
    const startSlot = Math.max(0, Math.min(NUM_SLOTS - 1, timeToSlot(ex.startMin)));
    const numSlots  = Math.max(1, Math.round(dur / INTERVAL_MIN));
    const perSlot   = ex.cal / numSlots;
    for (let s = startSlot; s < Math.min(startSlot + numSlots, NUM_SLOTS); s++) {
      exerciseBurnPerSlot[s] += perSlot;
    }
    totalExerciseCal += ex.cal;
  }

  const bmrTotal   = Math.max(0, caloriesOut - totalExerciseCal);
  const bmrPerSlot = bmrTotal / NUM_SLOTS;

  // ── Slot-by-slot bucket drain simulation ──────────────────────────────────
  const slots: MetabolicSlotData[] = [];
  let liverKcal            = Math.min(LIVER_MAX_KCAL, liverGlycogenStartKcal);
  let muscleGlycogenKcal   = Math.min(MUSCLE_GLYCOGEN_MAX_KCAL, muscleGlycogenStartKcal);
  let cumulativeFatBurned  = 0;
  let cumulativeFatStored  = 0;
  let cumulativeMuscleLost = 0;

  for (let s = 0; s < NUM_SLOTS; s++) {
    const burnThisSlot       = bmrPerSlot + exerciseBurnPerSlot[s];
    const absorptionThisSlot = absorptionPerSlot[s];
    const gutRemaining       = gutBySlot[s];  // unabsorbed food in gut at this slot

    // Step 1: absorbed calories cover burn first
    const gutContribution = Math.min(absorptionThisSlot, burnThisSlot);
    let remaining         = burnThisSlot - gutContribution;

    // Step 2: fat faucet — PAUSED while gut is non-empty (insulin suppresses lipolysis)
    let fatContribution = 0;
    if (gutRemaining <= 0 && remaining > 0) {
      fatContribution = Math.min(remaining, fatFaucetPerSlot);
    }
    remaining -= fatContribution;

    // Step 3: liver glycogen fills remaining requirement
    const liverContribution = Math.min(remaining, liverKcal);
    liverKcal = Math.max(0, liverKcal - liverContribution);
    // Replenish liver from carb fraction of absorbed calories (~6% of absorbed = 40% carbs × 15% to liver)
    liverKcal = Math.min(LIVER_MAX_KCAL, liverKcal + absorptionThisSlot * 0.06);
    remaining -= liverContribution;

    // Step 4: muscle glycogen — intramuscular stores, primary exercise buffer
    // Prevents muscle protein catabolism during exercise when liver is depleted.
    const muscleGlycoContribution = Math.min(remaining, muscleGlycogenKcal);
    muscleGlycogenKcal = Math.max(0, muscleGlycogenKcal - muscleGlycoContribution);
    // Replenish from dietary carbs (~15% of absorbed calories refill muscle stores)
    muscleGlycogenKcal = Math.min(MUSCLE_GLYCOGEN_MAX_KCAL, muscleGlycogenKcal + absorptionThisSlot * 0.15);
    remaining -= muscleGlycoContribution;

    // Step 5: muscle protein catabolism (true last resort — all glycogen exhausted)
    const muscleContribution = Math.max(0, remaining);

    // Surplus: excess absorption above burn → deposited as fat
    const fatStoredThisSlot = Math.max(0, absorptionThisSlot - burnThisSlot);

    cumulativeFatBurned  += fatContribution;
    cumulativeFatStored  += fatStoredThisSlot;
    cumulativeMuscleLost += muscleContribution;

    slots.push({
      slot: s,
      gutContribution:       Math.round(gutContribution),
      fatContribution:       Math.round(fatContribution),
      liverContribution:     Math.round(liverContribution),
      muscleContribution:    Math.round(muscleContribution),
      fatStoredThisSlot:     Math.round(fatStoredThisSlot),
      cumulativeFatBurned:   Math.round(cumulativeFatBurned),
      cumulativeFatStored:   Math.round(cumulativeFatStored),
      cumulativeMuscleLost:  Math.round(cumulativeMuscleLost),
      gutKcal:               Math.round(gutRemaining),
      liverKcal:             Math.round(liverKcal),
      fatAllowanceRemaining: Math.round(alpertNumber - cumulativeFatBurned),
    });
  }

  const totalFatBurned  = Math.round(cumulativeFatBurned);
  const totalFatStored  = Math.round(cumulativeFatStored);
  const totalMuscleLost = Math.round(cumulativeMuscleLost);

  return {
    slots,
    totalFatBurned,
    totalFatStored,
    totalMuscleLost,
    score: computeMetabolicScore(totalFatBurned, totalFatStored, totalMuscleLost),
  };
}

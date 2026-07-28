/**
 * @fileOverview Visceral Fat daily scoring engine (v3 — Effort Registers).
 *
 * SCORING: Points are normalized to each user's fat-oxidation ceiling, so the
 * scale means the same thing for every user regardless of body size.
 *   100 pts = burning 70% of the user's Alpert number in fat that day.
 *   Denominator  D = 0.70 × Alpert(weightKg, bodyFatPct)
 *   Score is UNCAPPED in both directions — no -200 floor, no +100 cap.
 *
 *   score = Σ_slot [ (fatBurned/D)×100 − (min(fatStored, faucet)/D)×100
 *                   − (muscleLost/10)×2 + (glycogenDrawn/D)×100 × 0.30 ]
 *           + behavioral penalties
 *
 * MECHANICS (v3.0):
 *   • Glycogen Credit — 30% credit for glycogen drawn during training/deficit,
 *     repaid from subsequent intake.
 *   • Storage Cap Symmetry — per-slot fat storage penalty is capped at the fat oxidation
 *     rate (alpertNumber / 24 / 4).
 *   • Consecutive-Day Alcohol — 25% of positive score (floored at 5 pts) deduction.
 *   • End-of-day Alcohol Pause — scaled penalty for late-night drinking to close the loophole.
 *   • Seed Oil Nudge — −5 pts per seed-oil meal.
 */

import type { FoodLogEntry, ExerciseLogEntry } from './food-exercise-types';
import type { FitbitActivity } from './health-service';
import {
  runMetabolicSimulation,
  computeMuscleGlycogenMaxKcal,
  pointsDenominator,
  computeFaucetPerSlot,
  GLYCOGEN_CREDIT_FRACTION,
  MUSCLE_PENALTY_PER_10KCAL,
  NUM_SLOTS,
} from './metabolic-engine';

// ── Scoring constants ─────────────────────────────────────────────────────────
const INTERVAL_MIN               = 15;
const START_MIN                  = 6 * 60;           // engine simulates from 6:00 AM
const ALC_PAUSE_SLOTS            = (3 * 60) / INTERVAL_MIN; // 3-hour pause = 12 slots
const SEED_OIL_PENALTY_PER_MEAL  = 5;                // flat points per seed-oil meal

const MEAL_DEFAULT_MIN: Record<string, number> = {
  breakfast: 7 * 60,
  lunch:     12 * 60 + 30,
  dinner:    18 * 60 + 30,
  snack:     15 * 60,
};

/** Compute maximum sustainable fat oxidation in kcal/day (Alpert 2005). */
export function computeAlpertNumber(weightKg?: number, bodyFatPct?: number): number {
  const kg = weightKg ?? 68;           // ~150 lbs default
  const bfFraction = bodyFatPct != null ? bodyFatPct / 100 : 0.25;
  const fatMassLbs = kg * bfFraction * 2.20462;
  return Math.round(Math.max(500, fatMassLbs * 31)); // floor at 500 to avoid div-by-zero extremes
}

function slotOfFood(food: FoodLogEntry): number {
  const min = food.consumedAt
    ? (() => { const [h, m] = food.consumedAt!.split(':').map(Number); return (h || 0) * 60 + (m || 0); })()
    : (MEAL_DEFAULT_MIN[food.meal] ?? 18 * 60 + 30);
  return Math.max(0, Math.min(NUM_SLOTS - 1, Math.round((min - START_MIN) / INTERVAL_MIN)));
}

export interface DailyVFInput {
  caloriesIn: number;
  caloriesOut: number;
  proteinG: number;
  proteinGoal: number;       // typically 150
  fastingHours: number;      // coaching context only (no longer a flat override)
  alcoholDrinks: number;     // daily total of alcoholic drinks
  sleepHours: number;        // coaching context only
  seedOilMeals: number;      // count of meals with heavy seed oil / deep-fried
  weightKg?: number;         // used for Alpert number / glycogen calculation
  bodyFatPct?: number;       // 0-100; used for Alpert number / glycogen calculation
  hrv?: number;              // 0-150; recovery multiplier inside the engine
  hasCreatine?: boolean;     // user supplement status
  // Optional: per-entry logs for precise slot simulation
  foodLogs?: FoodLogEntry[];
  exerciseLogs?: ExerciseLogEntry[];
  fitbitActivities?: FitbitActivity[];
  // ── Behavioral-rule input (resolved by the caller from history) ──
  alcoholYesterday?: boolean;   // alcohol logged the previous day → consecutive penalty
}

export interface DailyVFResult {
  score: number;
  breakdown: {
    // Engine outputs (now priced into the score)
    alpertNumber: number;
    pointsDenominator: number;     // D = 70% of Alpert
    deficit: number;
    totalFatBurned: number;
    totalFatStored: number;
    totalGlycogenDrawn: number;
    glycogenCreditPoints: number;
    fatStoragePenaltyCapped: number;
    muscleKcal: number;
    baseScore: number;             // engine score before behavioral penalties
    // Behavioral rule assessments
    proteinMet: boolean;
    fastingActive: boolean;
    alcoholDrinks: number;
    alcoholPausePenalty: number;   // points removed by the 3h-per-drink pause (≤ 0)
    consecutiveAlcoholPenalty: number; // proportional penalty when alcohol logged consecutive days
    seedOilMeals: number;
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
    seedOilMeals,
    weightKg,
    bodyFatPct,
    hrv,
    hasCreatine,
    foodLogs,
    exerciseLogs,
    fitbitActivities,
    alcoholYesterday,
  } = input;

  const alpertNumber = computeAlpertNumber(weightKg, bodyFatPct);
  const D = pointsDenominator(alpertNumber);   // 100 pts = burn 70% of Alpert in fat
  const deficit = caloriesOut - caloriesIn;

  // ── Run the metabolic simulation for per-slot fat/storage/muscle figures ─────
  const sim = runMetabolicSimulation({
    caloriesOut,
    alpertNumber,
    foodLogs,
    exerciseLogs,
    fitbitActivities,
    caloriesIn,
    hrv,
    hasCreatine,
    weightKg,
    bodyFatPct,
    muscleGlycogenMaxKcal: computeMuscleGlycogenMaxKcal(weightKg, bodyFatPct, hasCreatine),
  });

  // ── Volume-Based Metabolic Pause mask ───────────────────────────────────────
  // Each drink hard-caps the score at 0 for the next 3 hours.
  // Drinks near midnight scale their pause weight to prevent late-drinking loophole.
  const paused = new Array<boolean>(NUM_SLOTS).fill(false);
  const pauseWeight = new Array<number>(NUM_SLOTS).fill(1.0);
  const activeFoods = (foodLogs ?? []).filter((f) => !f.ignored);
  for (const f of activeFoods) {
    const drinks = f.alcoholDrinks ?? 0;
    if (drinks <= 0) continue;
    const s0 = slotOfFood(f);
    const slotsInSim = Math.min(ALC_PAUSE_SLOTS, NUM_SLOTS - s0);
    const scale = slotsInSim > 0 ? (ALC_PAUSE_SLOTS / slotsInSim) : 1.0;
    for (let s = s0; s < Math.min(s0 + ALC_PAUSE_SLOTS, NUM_SLOTS); s++) {
      paused[s] = true;
      pauseWeight[s] = Math.max(pauseWeight[s], scale);
    }
  }

  // ── Score the day slot-by-slot ──────────────────────────────────────────────
  const faucetPerSlot = computeFaucetPerSlot(alpertNumber);
  let baseScore = 0;    // engine score, Alpert-normalized, no behavioral penalties
  let pausedScore = 0;  // same, but positive accrual zeroed during alcohol pause
  let totalStorageExcusedKcal = 0;
  let totalGlycogenCreditPts = 0;

  for (const slot of sim.slots) {
    const storedThisSlot = Math.min(slot.fatStoredThisSlot, faucetPerSlot);
    totalStorageExcusedKcal += Math.max(0, slot.fatStoredThisSlot - storedThisSlot);

    const glycogenDrawnThisSlot = slot.liverContribution + slot.muscleGlycogenContribution;
    const glycogenCreditPts = ((glycogenDrawnThisSlot / D) * 100) * GLYCOGEN_CREDIT_FRACTION;
    totalGlycogenCreditPts += glycogenCreditPts;

    const net =
      (slot.fatContribution / D) * 100 -
      (storedThisSlot / D) * 100 -
      (slot.muscleContribution / 10) * MUSCLE_PENALTY_PER_10KCAL +
      glycogenCreditPts;

    baseScore += net;
    pausedScore += paused[slot.slot] ? Math.min(net * pauseWeight[slot.slot], 0) : net;
  }
  let alcoholPausePenalty = pausedScore - baseScore; // ≤ 0
  if (alcoholPausePenalty < 0 && activeFoods.some((f) => (f.alcoholDrinks ?? 0) > 0)) {
    let latestDrinkSlot = -1;
    for (const f of activeFoods) {
      if ((f.alcoholDrinks ?? 0) > 0) {
        latestDrinkSlot = Math.max(latestDrinkSlot, slotOfFood(f));
      }
    }
    if (latestDrinkSlot >= 0) {
      const slotsInSim = Math.min(ALC_PAUSE_SLOTS, NUM_SLOTS - latestDrinkSlot);
      if (slotsInSim > 0 && slotsInSim < ALC_PAUSE_SLOTS) {
        alcoholPausePenalty *= (ALC_PAUSE_SLOTS / slotsInSim);
      }
    }
  }

  let score = baseScore + alcoholPausePenalty;

  // ── Net Caloric Surplus Penalty ─────────────────────────────────────────────
  // When caloriesIn > caloriesOut, net surplus calories cannot be masked by capped storage
  const netSurplus = Math.max(0, caloriesIn - caloriesOut);
  const netSurplusPenalty = (netSurplus / D) * 100;
  score -= netSurplusPenalty;

  // ── Proportional Consecutive-Day Alcohol penalty ────────────────────────────
  const alcoholToday = alcoholDrinks > 0 || activeFoods.some((f) => (f.alcoholDrinks ?? 0) > 0);
  const consecutiveAlcoholPenalty =
    alcoholToday && alcoholYesterday
      ? -Math.max(5, Math.round(0.25 * Math.max(0, pausedScore)))
      : 0;
  score += consecutiveAlcoholPenalty;

  // ── Seed Oil Nudge (flat) ───────────────────────────────────────────────────
  const seedOilPenalty = seedOilMeals * -SEED_OIL_PENALTY_PER_MEAL;
  score += seedOilPenalty;

  // No clamp — the scale is unbounded in both directions.
  score = Math.round(score);

  // ── Coaching context ────────────────────────────────────────────────────────
  const proteinMet = proteinG >= proteinGoal;
  const fastingActive = fastingHours >= 16;
  const glycogenCreditPoints = Math.round(totalGlycogenCreditPts);
  const fatStoragePenaltyCapped = Math.round(totalStorageExcusedKcal);

  const parts: string[] = [
    `fat burned ${sim.totalFatBurned} kcal, stored ${sim.totalFatStored} kcal (excused ${fatStoragePenaltyCapped} kcal excess), glycogen debt credit +${glycogenCreditPoints} pts, muscle lost ${sim.totalMuscleLost} kcal → ${score} pts (100 = 70% of ${alpertNumber} Alpert)`,
  ];
  if (!proteinMet) parts.push(`protein short (${proteinG}/${proteinGoal}g)`);
  if (fastingActive) parts.push(`${fastingHours}h fast`);
  if (alcoholPausePenalty < 0) parts.push(`alcohol pause ${Math.round(alcoholPausePenalty)} pts`);
  if (consecutiveAlcoholPenalty < 0) parts.push(`consecutive-day drinking ${consecutiveAlcoholPenalty} pts`);
  if (seedOilMeals > 0) parts.push(`${seedOilMeals} seed-oil meal(s)`);

  return {
    score,
    breakdown: {
      alpertNumber,
      pointsDenominator: Math.round(D),
      deficit,
      totalFatBurned: sim.totalFatBurned,
      totalFatStored: sim.totalFatStored,
      totalGlycogenDrawn: sim.totalGlycogenDrawn,
      glycogenCreditPoints,
      fatStoragePenaltyCapped,
      muscleKcal: sim.totalMuscleLost,
      baseScore: Math.round(baseScore),
      proteinMet,
      fastingActive,
      alcoholDrinks,
      alcoholPausePenalty: Math.round(alcoholPausePenalty),
      consecutiveAlcoholPenalty,
      seedOilMeals,
      seedOilPenalty,
    },
    summary: `Daily VF score: ${score}. ${parts.join('; ')}.`,
  };
}

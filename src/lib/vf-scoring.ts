/**
 * @fileOverview Visceral Fat daily scoring engine (v2 — Alpert-normalized).
 *
 * SCORING: Points are normalized to each user's fat-oxidation ceiling, so the
 * scale means the same thing for every user regardless of body size.
 *   100 pts = burning 70% of the user's Alpert number in fat that day.
 *   Denominator  D = 0.70 × Alpert(weightKg, bodyFatPct)
 *   Score is UNCAPPED in both directions — no -200 floor, no +100 cap.
 *
 *   score = Σ_slot [ (fatBurned/D)×100 − (fatStored/D)×100 − (muscleLost/10)×2 ]
 *           + behavioral penalties
 *
 * The slot-level fat/storage/muscle figures come from the Hourly Metabolic
 * Partitioning Engine, so muscle catabolism is now PRICED INTO the score —
 * a deficit funded by muscle no longer scores like a deficit funded by fat.
 *
 * BEHAVIORAL PENALTIES (conditional):
 *   • Volume-Based Metabolic Pause — each alcoholic drink hard-caps the score
 *     at 0 for the following 3 hours (lipolysis suppressed by acetate clearance).
 *   • Consecutive-Day Alcohol — flat −25 if alcohol was logged yesterday AND today.
 *   • Seed Oil Nudge — −5 pts per seed-oil meal (systemic inflammation signal).
 *
 * NOTE: cardio is NOT point-penalized. A deficit funded by muscle already costs
 * points via the muscleLost term above, so there is no separate "junk cardio"
 * cap — the engine prices muscle loss honestly and the coach handles the rest.
 */

import type { FoodLogEntry, ExerciseLogEntry } from './food-exercise-types';
import type { FitbitActivity } from './health-service';
import {
  runMetabolicSimulation,
  computeMuscleGlycogenMaxKcal,
  pointsDenominator,
  MUSCLE_PENALTY_PER_10KCAL,
  NUM_SLOTS,
} from './metabolic-engine';

// ── Scoring constants ─────────────────────────────────────────────────────────
const INTERVAL_MIN               = 15;
const START_MIN                  = 6 * 60;           // engine simulates from 6:00 AM
const ALC_PAUSE_SLOTS            = (3 * 60) / INTERVAL_MIN; // 3-hour pause = 12 slots
const CONSECUTIVE_ALCOHOL_PENALTY = 25;              // flat points, consecutive-day drinking
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
    muscleKcal: number;
    baseScore: number;             // engine score before behavioral penalties
    // Behavioral rule assessments
    proteinMet: boolean;
    fastingActive: boolean;
    alcoholDrinks: number;
    alcoholPausePenalty: number;   // points removed by the 3h-per-drink pause (≤ 0)
    consecutiveAlcoholPenalty: number; // 0 or -25
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

  // Cardio is NOT point-penalized. A deficit funded by muscle already costs points
  // via the muscleLost term in the slot loop below, so glycogen-depleting anaerobic
  // play shows up honestly through muscle catabolism — no separate cardio cap. The
  // "tension deficit" pattern (lots of anaerobic play, no lifting) is handled as a
  // coaching nudge in the CFO prompt, not as a scoring penalty.

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
  // Each drink hard-caps the score at 0 for the next 3 hours. Overlapping windows
  // from multiple drinks simply union together.
  const paused = new Array<boolean>(NUM_SLOTS).fill(false);
  const activeFoods = (foodLogs ?? []).filter((f) => !f.ignored);
  for (const f of activeFoods) {
    const drinks = f.alcoholDrinks ?? 0;
    if (drinks <= 0) continue;
    const s0 = slotOfFood(f);
    for (let s = s0; s < Math.min(s0 + ALC_PAUSE_SLOTS, NUM_SLOTS); s++) paused[s] = true;
  }

  // ── Score the day slot-by-slot ──────────────────────────────────────────────
  let baseScore = 0;    // engine score, Alpert-normalized, no behavioral penalties
  let pausedScore = 0;  // same, but positive accrual zeroed during alcohol pause
  for (const slot of sim.slots) {
    const net =
      (slot.fatContribution / D) * 100 -
      (slot.fatStoredThisSlot / D) * 100 -
      (slot.muscleContribution / 10) * MUSCLE_PENALTY_PER_10KCAL;
    baseScore += net;
    pausedScore += paused[slot.slot] ? Math.min(net, 0) : net;
  }
  const alcoholPausePenalty = pausedScore - baseScore; // ≤ 0

  let score = pausedScore;

  // ── Consecutive-Day Alcohol penalty (flat) ──────────────────────────────────
  const alcoholToday = alcoholDrinks > 0 || activeFoods.some((f) => (f.alcoholDrinks ?? 0) > 0);
  const consecutiveAlcoholPenalty =
    alcoholToday && alcoholYesterday ? -CONSECUTIVE_ALCOHOL_PENALTY : 0;
  score += consecutiveAlcoholPenalty;

  // ── Seed Oil Nudge (flat) ───────────────────────────────────────────────────
  const seedOilPenalty = seedOilMeals * -SEED_OIL_PENALTY_PER_MEAL;
  score += seedOilPenalty;

  // No clamp — the scale is unbounded in both directions.
  score = Math.round(score);

  // ── Coaching context ────────────────────────────────────────────────────────
  const proteinMet = proteinG >= proteinGoal;
  const fastingActive = fastingHours >= 16;

  const parts: string[] = [
    `fat burned ${sim.totalFatBurned} kcal, stored ${sim.totalFatStored} kcal, muscle lost ${sim.totalMuscleLost} kcal → ${score} pts (100 = 70% of ${alpertNumber} Alpert)`,
  ];
  if (!proteinMet) parts.push(`protein short (${proteinG}/${proteinGoal}g)`);
  if (fastingActive) parts.push(`${fastingHours}h fast`);
  if (alcoholPausePenalty < 0) parts.push(`alcohol pause ${Math.round(alcoholPausePenalty)} pts`);
  if (consecutiveAlcoholPenalty < 0) parts.push(`consecutive-day drinking -25`);
  if (seedOilMeals > 0) parts.push(`${seedOilMeals} seed-oil meal(s)`);

  return {
    score,
    breakdown: {
      alpertNumber,
      pointsDenominator: Math.round(D),
      deficit,
      totalFatBurned: sim.totalFatBurned,
      totalFatStored: sim.totalFatStored,
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

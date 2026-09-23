/**
 * @fileOverview Visceral Fat daily scoring engine (v3.2 — Energy Balance).
 *
 * SCORING: Points are normalized to each user's fat-oxidation ceiling, so the
 * scale means the same thing for every user regardless of body size.
 *   100 pts = losing fat equal to 70% of the user's Alpert number that day.
 *   Denominator  D = 0.70 × Alpert(weightKg, bodyFatPct)
 *   Score is UNCAPPED below; fat credit is capped at the Alpert ceiling above.
 *
 *   fat   = min(Alpert, (caloriesOut − caloriesIn) − muscleLost)
 *   score = (fat / D) × 100 − (muscleLost / 10) × 2 − alcoholPenalty − seedOil
 *
 * v3.2: glycogen is neutral. The slot simulation still runs, but only to decide
 * how much of the deficit came out of muscle (and for the intraday charts). The
 * v3.0 glycogen credit, per-slot storage cap and net-surplus penalty are gone —
 * a surplus now shows up directly as negative fat. See the fat-balance block.
 *
 * ALCOHOL (v3.1) — replaces the v2/v3 "metabolic pause" mask.
 *   The old rule zeroed POSITIVE score accrual for 3h per drinking entry. That made
 *   it an opportunity cost, and opportunity cost is zero whenever the counterfactual
 *   is zero: post-meal slots are already negative (insulin has closed the fat faucet
 *   and the gut is covering the burn), so drinking straight after dinner cost exactly
 *   nothing, and drink COUNT was never read at all — 1 beer and 20 beers masked
 *   identically. Any multiplicative, supply-side mechanism has the same blind spot;
 *   you cannot scale down a zero.
 *
 *   v3.1 debits the counterfactual directly instead: each standard drink costs its
 *   clearance-hours of the UNIMPEDED fat-oxidation ceiling, whatever those hours were
 *   actually doing. Volume scales it, timing cannot shield it, and the penalty
 *   survives being logged as one bulk entry. The v3 consecutive-day penalty is gone
 *   too — it scaled off the day's own positive score, so the worse the bender the
 *   cheaper it got. See metabolic-engine.ts for the ADH/NADH derivation of the shape.
 */

import type { FoodLogEntry, ExerciseLogEntry } from './food-exercise-types';
import type { FitbitActivity } from './health-service';
import {
  runMetabolicSimulation,
  computeMuscleGlycogenMaxKcal,
  pointsDenominator,
  clearanceHoursPerDrink,
  alcoholSuppressionDepth,
  PTS_PER_SUPPRESSED_HOUR,
  MUSCLE_PENALTY_PER_10KCAL,
  NUM_SLOTS,
} from './metabolic-engine';

// ── Scoring constants ─────────────────────────────────────────────────────────
const INTERVAL_MIN               = 15;
const START_MIN                  = 6 * 60;           // engine simulates from 6:00 AM
const SEED_OIL_PENALTY_PER_MEAL  = 5;                // flat points per seed-oil meal
const DEFAULT_DRINK_MIN          = 20 * 60;          // 20:00 — assumed time when only a daily count is known

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

function minuteOfFood(food: FoodLogEntry): number {
  return food.consumedAt
    ? (() => { const [h, m] = food.consumedAt!.split(':').map(Number); return (h || 0) * 60 + (m || 0); })()
    : (MEAL_DEFAULT_MIN[food.meal] ?? 18 * 60 + 30);
}

function slotOfFood(food: FoodLogEntry): number {
  return Math.max(0, Math.min(NUM_SLOTS - 1, Math.round((minuteOfFood(food) - START_MIN) / INTERVAL_MIN)));
}

/** Resolved acute alcohol load for one day. Penalty figures are ≤ 0. */
export interface AlcoholLoad {
  drinks: number;
  hoursPerDrink: number;      // clearance scalar for this body
  suppressionHours: number;   // total clearance time the session bought
  depth: number;              // 0..DMAX fraction of fat oxidation suppressed
  clearsAtHour: number;       // decimal hour clearance completes (>24 = after midnight)
  hoursPastMidnight: number;  // informational for coaching — carries NO points
  penalty: number;            // points debited on the drinking day, in full
}

const EMPTY_LOAD = (hoursPerDrink: number): AlcoholLoad => ({
  drinks: 0, hoursPerDrink, suppressionHours: 0, depth: 0,
  clearsAtHour: 0, hoursPastMidnight: 0, penalty: 0,
});

/**
 * Resolve a day's alcohol into suppressed clearance-hours and the points they cost.
 *
 * The FULL session is charged to the day it was drunk, including clearance that runs
 * past midnight. v3.1.0 deferred the overnight remainder to the next day, which was
 * conservative across two days but wrong on the one number the client actually sees:
 * 7.5 drinks logged at 23:15 put 88% of the cost on tomorrow and scored 81 — better
 * than the same drinks at 18:00. That re-opened the late-drinking loophole v3.0's
 * pause-weight rescale had already closed. Midnight is a calendar artifact, not
 * physiology: the session incurred the suppression, so the session pays for it.
 *
 * Clearance is zero-order and continuous, so the window opens at the FIRST drink and
 * runs for the full dose duration regardless of how the drinks were batched into log
 * entries — that deliberately removes any dependence on logging granularity (ten
 * beers as one entry and as ten entries must cost the same).
 */
export function computeAlcoholLoad(opts: {
  foodLogs?: FoodLogEntry[];
  fallbackDrinks?: number;   // used when only a daily total is known (no per-entry logs)
  heightCm?: number;
  weightKg?: number;
  age?: number;
}): AlcoholLoad {
  const hoursPerDrink = clearanceHoursPerDrink(opts.heightCm, opts.weightKg, opts.age);
  const entries = (opts.foodLogs ?? []).filter((f) => !f.ignored && (f.alcoholDrinks ?? 0) > 0);
  const loggedDrinks = entries.reduce((s, f) => s + (f.alcoholDrinks ?? 0), 0);
  const drinks = loggedDrinks > 0 ? loggedDrinks : Math.max(0, opts.fallbackDrinks ?? 0);
  if (drinks <= 0) return EMPTY_LOAD(hoursPerDrink);

  const startMin = entries.length > 0
    ? Math.min(...entries.map(minuteOfFood))
    : DEFAULT_DRINK_MIN;

  const suppressionHours = drinks * hoursPerDrink;
  const depth            = alcoholSuppressionDepth(drinks);
  const clearsAtHour     = startMin / 60 + suppressionHours;

  return {
    drinks,
    hoursPerDrink,
    suppressionHours,
    depth,
    clearsAtHour,
    hoursPastMidnight: Math.max(0, clearsAtHour - 24),
    // Charged in full on the drinking day — no dependence on when the session started.
    penalty: -suppressionHours * depth * PTS_PER_SUPPRESSED_HOUR,
  };
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
  heightCm?: number;         // with age → BSA → hepatic alcohol clearance rate
  age?: number;              // liver volume declines past 40; slows clearance
  hrv?: number;              // 0-150; recovery multiplier inside the engine
  hasCreatine?: boolean;     // user supplement status
  // Optional: per-entry logs for precise slot simulation
  foodLogs?: FoodLogEntry[];
  exerciseLogs?: ExerciseLogEntry[];
  fitbitActivities?: FitbitActivity[];
  // ── Cross-day context (resolved by the caller from history) ──
  alcoholYesterday?: boolean;   // coaching context only; drives no penalty since v3.1
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
    glycogenNetKcal: number;          // end − start glycogen (informational; carries no points)
    fatBalanceKcal: number;           // min(Alpert, deficit − muscle): the fat the score credits
    deficitBeyondAlpertKcal: number;  // deficit the Alpert ceiling refused to count as fat
    /** @deprecated v3.0–v3.1 only. */
    glycogenCreditPoints: number;
    /** @deprecated v3.0–v3.1 only. */
    fatStoragePenaltyCapped: number;
    muscleKcal: number;
    baseScore: number;             // engine score before behavioral penalties
    // Behavioral rule assessments
    proteinMet: boolean;
    fastingActive: boolean;
    alcoholDrinks: number;
    // ── Alcohol (v3.1) ──
    alcoholAcutePenalty: number;      // ≤ 0; the whole session, charged to this day
    alcoholSuppressionHours: number;  // total clearance time the session bought
    alcoholHoursPastMidnight: number; // informational for coaching; carries no points
    alcoholHoursPerDrink: number;     // per-body clearance scalar actually used
    /** @deprecated v3.1 alias of alcoholAcutePenalty; kept so pre-v3.1 history renders. */
    alcoholPausePenalty: number;
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
    heightCm,
    age,
    hrv,
    hasCreatine,
    foodLogs,
    exerciseLogs,
    fitbitActivities,
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
    heightCm,
    age,
    muscleGlycogenMaxKcal: computeMuscleGlycogenMaxKcal(weightKg, bodyFatPct, hasCreatine),
  });

  // ── Fat balance (v3.2): energy balance, glycogen-neutral ──────────────────
  // The simulation starts every day at the same glycogen level and never carries
  // it over, so its per-day glycogen swing is an artifact — a hard-training day
  // looks "paid for by glycogen", and the refill meal the next day is never
  // charged either. Over any run of days glycogen returns to where it was, so
  // what's left of the deficit after muscle is fat. Scoring that directly makes
  // the potato after basketball neutral (sugar in, sugar out) and removes the
  // v3.0 glycogen credit and per-slot storage cap, both of which were patches
  // for the old accounting (the credit made maintenance days score ~+18).
  //
  // The simulation still decides the fat-vs-muscle split: when the deficit
  // outruns the fat faucet and glycogen, it books muscle, which is both
  // subtracted here and penalized below. Fat loss is capped at the Alpert
  // ceiling — deficit beyond it is not fat, however hard the day was.
  const muscleKcal = sim.totalMuscleLost;
  const fatBalanceUncapped = deficit - muscleKcal;
  const fatBalanceKcal = Math.min(alpertNumber, fatBalanceUncapped);
  const deficitBeyondAlpertKcal = Math.max(0, fatBalanceUncapped - alpertNumber);

  const fatPoints = (fatBalanceKcal / D) * 100;
  const musclePenaltyPoints = (muscleKcal / 10) * MUSCLE_PENALTY_PER_10KCAL;
  const baseScore = fatPoints - musclePenaltyPoints;

  let score = baseScore;

  // ── Alcohol: counterfactual debit on suppressed clearance-hours ──────────────
  // The whole session is charged here, overnight remainder included, so the number
  // does not depend on which side of midnight the drinking started.
  const alcoholLoad = computeAlcoholLoad({
    foodLogs, fallbackDrinks: alcoholDrinks, heightCm, weightKg, age,
  });
  score += alcoholLoad.penalty;

  // ── Seed Oil Nudge (flat) ───────────────────────────────────────────────────
  const seedOilPenalty = seedOilMeals * -SEED_OIL_PENALTY_PER_MEAL;
  score += seedOilPenalty;

  // No clamp — the scale is unbounded in both directions.
  score = Math.round(score);

  // ── Coaching context ────────────────────────────────────────────────────────
  const proteinMet = proteinG >= proteinGoal;
  const fastingActive = fastingHours >= 16;
  const glycogenNetKcal = sim.glycogenEndKcal - sim.glycogenStartKcal;

  const parts: string[] = [
    `deficit ${deficit} kcal − muscle ${muscleKcal} kcal = fat ${Math.round(fatBalanceKcal)} kcal` +
    (deficitBeyondAlpertKcal > 0 ? ` (capped at the ${alpertNumber} kcal Alpert ceiling — the other ${Math.round(deficitBeyondAlpertKcal)} kcal of deficit came from glycogen or lean tissue, not fat)` : '') +
    ` → ${score} pts (100 = 70% of ${alpertNumber} Alpert)`,
  ];
  if (glycogenNetKcal <= -200) {
    parts.push(`glycogen tank ran ${-glycogenNetKcal} kcal low — carbs refill it without costing points`);
  }
  if (!proteinMet) parts.push(`protein short (${proteinG}/${proteinGoal}g)`);
  if (fastingActive) parts.push(`${fastingHours}h fast`);
  if (alcoholLoad.penalty < 0) {
    parts.push(
      `${alcoholLoad.drinks} drink(s) suppressed ${alcoholLoad.suppressionHours.toFixed(1)}h of fat oxidation ` +
      `(${Math.round(alcoholLoad.depth * 100)}% depth) → ${Math.round(alcoholLoad.penalty)} pts`,
    );
    if (alcoholLoad.hoursPastMidnight > 0) {
      parts.push(`still clearing ${alcoholLoad.hoursPastMidnight.toFixed(1)}h past midnight (charged to this day)`);
    }
  }
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
      glycogenNetKcal,
      fatBalanceKcal: Math.round(fatBalanceKcal),
      deficitBeyondAlpertKcal: Math.round(deficitBeyondAlpertKcal),
      /** @deprecated retired in v3.2 (always 0); kept so pre-v3.2 history renders. */
      glycogenCreditPoints: 0,
      /** @deprecated retired in v3.2 (always 0); kept so pre-v3.2 history renders. */
      fatStoragePenaltyCapped: 0,
      muscleKcal,
      baseScore: Math.round(baseScore),
      proteinMet,
      fastingActive,
      alcoholDrinks,
      alcoholAcutePenalty:      Math.round(alcoholLoad.penalty),
      alcoholSuppressionHours:  Number(alcoholLoad.suppressionHours.toFixed(2)),
      alcoholHoursPastMidnight: Number(alcoholLoad.hoursPastMidnight.toFixed(2)),
      alcoholHoursPerDrink:     Number(alcoholLoad.hoursPerDrink.toFixed(3)),
      alcoholPausePenalty:      Math.round(alcoholLoad.penalty), // deprecated alias
      seedOilMeals,
      seedOilPenalty,
    },
    summary: `Daily VF score: ${score}. ${parts.join('; ')}.`,
  };
}

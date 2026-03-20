/**
 * @fileOverview Visceral Fat daily scoring engine.
 *
 * SCORING: Alpert-number based.
 *   Alpert number = max sustainable fat oxidation (kcal/day) per body composition.
 *   Formula: fat mass (lbs) × 31 kcal/lb/day  [Alpert 2005]
 *   Score = clamp(deficit / alpertNumber × 100, -∞, 100)
 *     • 100 pts  = burned at maximum sustainable fat-loss rate
 *     • 0 pts    = break-even (maintenance)
 *     • negative = caloric surplus
 *
 * 5-RULE ASSESSMENTS (coaching context, not scoring):
 *   Rule 1 — Caloric Engine    (base deficit context)
 *   Rule 2 — Fasting Multiplier
 *   Rule 3 — Alcohol Freeze
 *   Rule 4 — Cortisol Tax
 *   Rule 5 — Seed Oil Penalty
 */

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
}

export interface DailyVFResult {
  score: number;
  breakdown: {
    // Alpert core
    alpertNumber: number;
    deficit: number;
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
  } = input;

  const alpertNumber = computeAlpertNumber(weightKg, bodyFatPct);
  const deficit = caloriesOut - caloriesIn;
  const score = Math.min(100, Math.round((deficit / alpertNumber) * 100));

  // --- Coaching context assessments (informational only) ---
  const proteinMet = proteinG >= proteinGoal;
  const fastingActive = fastingHours >= 16;   // noteworthy at 16h+
  const alcoholFlag = alcoholDrinks > 2;
  const poorSleep = sleepHours < 6;

  // Build summary
  const pct = Math.abs(Math.round((deficit / alpertNumber) * 100));
  const directionLabel = deficit >= 0 ? 'deficit' : 'surplus';
  const parts: string[] = [
    `${Math.abs(deficit)} kcal ${directionLabel} vs ${alpertNumber} kcal Alpert max → ${score} pts`,
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
      proteinMet,
      fastingActive,
      alcoholFlag,
      poorSleep,
      seedOilMeals,
    },
    summary: `Daily VF score: ${score}. ${parts.join('; ')}.`,
  };
}

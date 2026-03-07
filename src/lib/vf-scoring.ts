/**
 * @fileOverview Visceral Fat daily scoring engine.
 *
 * Five rules determine a daily VF score (typically -200 to +100):
 *
 * Rule 1 — Caloric Engine: base score from caloric deficit (max +100).
 *          Requires 150g protein to claim +100.
 * Rule 2 — Fasting Multiplier: 24+ hour clean fast = automatic +100, bypasses calorie math.
 * Rule 3 — Alcohol Freeze: >2 drinks caps score at 0; surplus + alcohol = -100 to -200.
 * Rule 4 — Cortisol Tax: <6 hours sleep halves any positive score.
 * Rule 5 — Seed Oil Penalty: each seed-oil-heavy meal deducts -25 ("Inflammation Tax").
 */

export interface DailyVFInput {
  caloriesIn: number;
  caloriesOut: number;
  proteinG: number;
  proteinGoal: number;         // typically 150
  fastingHours: number;        // consecutive clean fast hours for the day
  alcoholDrinks: number;       // number of alcoholic drinks consumed
  sleepHours: number;
  seedOilMeals: number;        // count of meals with heavy seed oil / deep-fried
}

export interface DailyVFResult {
  score: number;
  breakdown: {
    baseScore: number;
    fastingOverride: boolean;
    alcoholCap: boolean;
    alcoholPenalty: number;
    cortisolMultiplier: number;
    seedOilPenalty: number;
    proteinMet: boolean;
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
  } = input;

  const proteinMet = proteinG >= proteinGoal;

  // --- Rule 2: Fasting Multiplier (checked first — overrides calorie math) ---
  const fastingOverride = fastingHours >= 24;

  // --- Rule 1: Caloric Engine ---
  let baseScore: number;
  if (fastingOverride) {
    // 24+ hour clean fast guarantees +100 (all energy from body fat)
    baseScore = 100;
  } else {
    const deficit = caloriesOut - caloriesIn;
    if (deficit <= 0) {
      // Surplus: scale from 0 to -100 based on how far over
      // Every 500 cal surplus = -100
      baseScore = Math.max(-100, Math.round((deficit / 500) * 100));
    } else {
      // Deficit: scale toward +100, where ~1000 cal deficit = +100
      baseScore = Math.min(100, Math.round((deficit / 1000) * 100));
      // Protein gate: cannot claim +100 without hitting protein goal
      if (baseScore > 0 && !proteinMet) {
        baseScore = Math.min(baseScore, 50);
      }
    }
  }

  // --- Rule 3: Alcohol Freeze ---
  let alcoholCap = false;
  let alcoholPenalty = 0;
  if (alcoholDrinks > 2) {
    alcoholCap = true;
    const surplus = caloriesIn - caloriesOut;
    if (surplus > 0) {
      // In surplus + alcohol: -100 to -200
      alcoholPenalty = -Math.min(200, Math.max(100, Math.round((surplus / 500) * 100) + 100));
    }
    // Cap the base score at 0 (can't claim a fat-burning day)
    baseScore = Math.min(0, baseScore);
  }

  // Start with base + alcohol penalty
  let score = baseScore + alcoholPenalty;

  // --- Rule 4: Cortisol Tax ---
  let cortisolMultiplier = 1;
  if (sleepHours < 6) {
    cortisolMultiplier = 0.5;
    // Only halve positive scores
    if (score > 0) {
      score = Math.round(score * cortisolMultiplier);
    }
  }

  // --- Rule 5: Seed Oil Penalty ---
  const seedOilPenalty = -25 * seedOilMeals;
  score += seedOilPenalty;

  // Clamp to [-200, 100]
  score = Math.max(-200, Math.min(100, score));

  // Build summary
  const parts: string[] = [];
  if (fastingOverride) parts.push('24h+ fast -> automatic +100 base');
  else if (baseScore > 0) parts.push(`caloric deficit -> +${baseScore} base`);
  else if (baseScore < 0) parts.push(`caloric surplus -> ${baseScore} base`);
  else parts.push('break-even calories -> 0 base');

  if (!proteinMet && !fastingOverride) parts.push(`protein mandate missed (${proteinG}/${proteinGoal}g) -> capped`);
  if (alcoholCap) parts.push(`${alcoholDrinks} drinks -> market halted at 0`);
  if (alcoholPenalty < 0) parts.push(`surplus + alcohol -> ${alcoholPenalty} penalty`);
  if (cortisolMultiplier < 1 && (baseScore + alcoholPenalty) > 0) parts.push(`<6h sleep -> 50% cortisol tax`);
  if (seedOilPenalty < 0) parts.push(`${seedOilMeals} seed-oil meal(s) -> ${seedOilPenalty} inflammation tax`);

  return {
    score,
    breakdown: {
      baseScore,
      fastingOverride,
      alcoholCap,
      alcoholPenalty,
      cortisolMultiplier,
      seedOilPenalty,
      proteinMet,
    },
    summary: `Daily VF score: ${score}. ${parts.join('; ')}.`,
  };
}

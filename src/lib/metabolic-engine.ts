/**
 * @fileOverview Hourly Metabolic Partitioning Engine
 *
 * Simulates 5-bucket sequential energy drain across 15-minute slots from 6 AM to midnight.
 *
 * Drain priority per slot:
 *   1. Gut / Exogenous    — food being absorbed (insulin suppresses lipolysis)
 *   2. Fat Faucet         — rate-limited at alpertNumber/24/4 per slot; PAUSED while gut non-empty
 *   3. Liver Glycogen     — 400 kcal cap; replenishes from absorbed carbs
 *   4. Muscle Glycogen    — lean-mass-scaled cap; primary exercise buffer; replenishes from dietary carbs
 *   5. Muscle Protein     — true last resort; contributes to score penalty
 */

import type { FoodLogEntry, ExerciseLogEntry } from './food-exercise-types';
import type { FitbitActivity } from './health-service';

// ── Simulation constants ──────────────────────────────────────────────────────
const INTERVAL_MIN = 15;
const START_MIN    = 6 * 60;   // 6:00 AM
const END_MIN      = 24 * 60;  // midnight
export const NUM_SLOTS = Math.ceil((END_MIN - START_MIN) / INTERVAL_MIN) + 1; // 73

const LIVER_MAX_KCAL               = 400;   // 100g glycogen × 4 kcal/g
export const BASELINE_KCAL         = 1200;  // PSMF perfect-day denominator
const MUSCLE_PENALTY_PER_10KCAL    = 2;     // score points lost per 10 kcal muscle burned
const INSULIN_DECAY_RATE           = 0.125; // clears a max spike (1.0) in ~2 hours (8 slots)

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

export function computeMuscleGlycogenMaxKcal(weightKg?: number, bodyFatPct?: number, hasCreatine?: boolean): number {
  const kg = weightKg ?? 70;
  const bfFraction = (bodyFatPct ?? 20) / 100;
  const leanKg = kg * (1 - bfFraction);
  let baseMax = leanKg * 60;
  if (hasCreatine) baseMax *= 1.15;
  return Math.round(Math.max(800, Math.min(2400, baseMax)));
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface MetabolicEngineParams {
  caloriesOut: number;
  alpertNumber: number;
  foodLogs?: FoodLogEntry[];
  exerciseLogs?: ExerciseLogEntry[];
  fitbitActivities?: FitbitActivity[];
  liverGlycogenStartKcal?: number;
  morningGlycogenPct?: number;
  caloriesIn?: number;
  hrv?: number;
  hasCreatine?: boolean;
  weightKg?: number;
  bodyFatPct?: number;
}

export interface MetabolicSlotData {
  slot: number;
  gutContribution: number;
  fatContribution: number;
  liverContribution: number;
  muscleGlycogenContribution: number;
  muscleContribution: number;
  fatStoredThisSlot: number;
  // Advanced modeling (informational)
  insulinLevel: number;        // 0.0 - 1.0 (1.0 = max suppression)
  fatOxEfficiency: number;     // 0.0 - 1.0 (impact of insulin/caffeine/HRV)
  anabolicSignal: number;      // 0.0 - 1.0 (MPS signal intensity)
  caffeineLevel: number;       // mg currently active in system
  cumulativeFatBurned: number;
  cumulativeFatStored: number;
  cumulativeMuscleLost: number;
  cumulativeGlycogenDrawn: number;
  cumulativeAnabolicPotential: number; // Running total of MPS "units"
  // Bucket levels at end of slot (for gauge visualization and coaching)
  gutKcal: number;
  liverKcal: number;
  muscleGlycogenKcal: number;
  fatAllowanceRemaining: number;
}

export interface MetabolicResult {
  slots: MetabolicSlotData[];
  totalFatBurned: number;
  totalFatStored: number;
  totalMuscleLost: number;
  totalGlycogenDrawn: number;
  totalOmega3Mg: number;
  totalAnabolicPotential: number;
  muscleGlycogenMaxKcal: number;
  score: number;
}

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

export function runMetabolicSimulation(params: MetabolicEngineParams): MetabolicResult {
  const {
    caloriesOut,
    alpertNumber,
    foodLogs,
    exerciseLogs,
    fitbitActivities,
    caloriesIn = 0,
    hrv = 50,
    hasCreatine = false,
  } = params;

  const muscleMax = params.muscleGlycogenMaxKcal ?? computeMuscleGlycogenMaxKcal(params.weightKg, params.bodyFatPct, hasCreatine);
  const liverGlycogenStartKcal = params.liverGlycogenStartKcal ?? 280;
  const morningPct = params.morningGlycogenPct ?? 80;
  const muscleGlycogenStartKcal = Math.round(muscleMax * (morningPct / 100));

  let hrvMultiplier = 1.0;
  if (hrv < 30) hrvMultiplier = 0.85;
  else if (hrv > 80) hrvMultiplier = 1.10;

  let totalOmega3Mg = 0;
  foodLogs?.forEach(f => { if (!f.ignored) totalOmega3Mg += f.omega3Mg || 0; });
  const sensitivityMultiplier = totalOmega3Mg >= 2000 ? 1.1 : 1.0;

  const absorptionPerSlot = new Array<number>(NUM_SLOTS).fill(0);
  const gutBySlot         = new Array<number>(NUM_SLOTS).fill(0);
  const insulinSpikes     = new Array<number>(NUM_SLOTS).fill(0);
  const proteinSpikes     = new Array<number>(NUM_SLOTS).fill(0);
  const caffeineIntake    = new Array<number>(NUM_SLOTS).fill(0);
  const liverAlcoholDrain  = new Array<number>(NUM_SLOTS).fill(0);
  const exerciseBurnPerSlot = new Array<number>(NUM_SLOTS).fill(0);
  const strengthSlots         = new Array<boolean>(NUM_SLOTS).fill(false);

  const activeFoods = foodLogs?.filter(f => !f.ignored) ?? [];

  if (activeFoods.length > 0) {
    for (const food of activeFoods) {
      const eatMin  = food.consumedAt ? parseHHMM(food.consumedAt) : (MEAL_DEFAULT_MIN[food.meal] ?? 12 * 60);
      const eatSlot = Math.max(0, Math.min(NUM_SLOTS - 1, timeToSlot(eatMin)));
      
      const fiberDelaySlots = Math.round((food.fiberG || 0) * 0.5);
      const fatDelaySlots   = Math.round((food.fatG || 0) * 0.2);
      const absorptionDuration = Math.min(24, 6 + fiberDelaySlots + fatDelaySlots);
      
      const perSlot = food.calories / absorptionDuration;
      for (let s = eatSlot; s < Math.min(eatSlot + absorptionDuration, NUM_SLOTS); s++) {
        absorptionPerSlot[s] += perSlot;
        gutBySlot[s] += food.calories * (1 - (s - eatSlot) / absorptionDuration);
      }

      const carbKcal = (food.carbsG || 0) * 4;
      const giFactor = (food.glycemicIndex || 50) / 100;
      const spike = Math.min(1.0, (carbKcal / 400) * giFactor);
      if (spike > 0) insulinSpikes[eatSlot] += spike;

      // Protein spikes for MPS (20g+ amino acid availability)
      if (food.proteinG >= 20) proteinSpikes[eatSlot] += Math.min(1.0, food.proteinG / 40);

      if (food.caffeineMg) caffeineIntake[eatSlot] += food.caffeineMg;

      const drinks = food.alcoholDrinks || 0;
      if (drinks > 0) {
        const totalDrain = drinks * 30;
        for (let s = eatSlot; s < Math.min(eatSlot + 4, NUM_SLOTS); s++) {
          liverAlcoholDrain[s] += totalDrain / 4;
        }
      }
    }
  } else if (caloriesIn > 0) {
    const meals = [
      { slot: timeToSlot(7 * 60),       kcal: caloriesIn * 0.25 },
      { slot: timeToSlot(12 * 60 + 30), kcal: caloriesIn * 0.35 },
      { slot: timeToSlot(18 * 60 + 30), kcal: caloriesIn * 0.40 },
    ];
    for (const m of meals) {
      const eatSlot = Math.max(0, Math.min(NUM_SLOTS - 1, m.slot));
      const perSlot = m.kcal / 6;
      for (let s = eatSlot; s < Math.min(eatSlot + 6, NUM_SLOTS); s++) {
        absorptionPerSlot[s] += perSlot;
        gutBySlot[s] += m.kcal * (1 - (s - eatSlot) / 6);
      }
      insulinSpikes[eatSlot] += (m.kcal / 1000);
    }
  }

  // Exercise & Growth Signals
  let strengthTrainingActive = false;
  const activeLogs = exerciseLogs?.filter(e => !e.ignored) ?? [];
  const logsToUse = activeLogs.length > 0
    ? activeLogs.map(ex => {
        if (ex.category === 'strength') strengthTrainingActive = true;
        return {
          cal: ex.adjustedCalories || ex.estimatedCaloriesBurned || 0,
          dur: Math.max(15, ex.durationMin || 30),
          start: ex.performedAt ? parseHHMM(ex.performedAt) : 12 * 60,
          isStrength
        };
      })
    : (fitbitActivities ?? []).map(act => {
          const isStrength = act.activityName?.toLowerCase().includes('weight') || 
                            act.activityName?.toLowerCase().includes('lift') || 
                            act.activityTier === 'tier3_anaerobic';
          if (isStrength) strengthTrainingActive = true;
          return {
            cal: Math.round(act.calories * (TIER_DISCOUNT[act.activityTier] ?? 0.80)),
            dur: Math.max(15, act.durationMin),
            start: parseHHMM(act.startTime),
            isStrength
          };
      });

  let totalExerciseCal = 0;
  for (const ex of logsToUse) {
    if (ex.cal <= 0) continue;
    const startSlot = Math.max(0, Math.min(NUM_SLOTS - 1, timeToSlot(ex.start)));
    const numSlots  = Math.max(1, Math.round(ex.dur / INTERVAL_MIN));
    const perSlot   = ex.cal / numSlots;
    for (let s = startSlot; s < Math.min(startSlot + numSlots, NUM_SLOTS); s++) {
      exerciseBurnPerSlot[s] += perSlot;
      if ((ex as any).isStrength || activeLogs.find(l => l.name === (ex as any).name)?.category === 'strength') {
        strengthSlots[s] = true;
      }
    }
    totalExerciseCal += ex.cal;
  }

  const bmrPerSlot = Math.max(0, caloriesOut - totalExerciseCal) / NUM_SLOTS;

  const slots: MetabolicSlotData[] = [];
  let liverKcal           = Math.min(LIVER_MAX_KCAL, liverGlycogenStartKcal);
  let muscleGlycogenKcal  = Math.min(muscleMax, muscleGlycogenStartKcal);
  let insulinLevel        = 0;
  let proteinLevel        = 0; // Amino acid availability (MPS window)
  let caffeineLevel       = 0;
  let cumulativeFatBurned  = 0;
  let cumulativeFatStored  = 0;
  let cumulativeMuscleLost = 0;
  let cumulativeGlycogenDrawn = 0;
  let cumulativeAnabolicPotential = 0;

  for (let s = 0; s < NUM_SLOTS; s++) {
    // 1. Decay and Update Hormones/Drugs/Nutrients
    insulinLevel = Math.max(0, (insulinLevel + (insulinSpikes[s] || 0)) - (INSULIN_DECAY_RATE * sensitivityMultiplier));
    insulinLevel = Math.min(1.0, insulinLevel);

    // Protein decay: 20g+ clears in ~4-5 hours
    proteinLevel = (proteinLevel * 0.9) + (proteinSpikes[s] || 0);
    proteinLevel = Math.min(1.0, proteinLevel);

    caffeineLevel = (caffeineLevel * 0.965) + (caffeineIntake[s] || 0);

    // 2. Calculate Efficiency & Growth Signals
    const caffeineBoost = Math.min(0.20, (caffeineLevel / 100) * 0.05);
    // Hydration Drag: Alcohol processing (liverAlcoholDrain > 0) imposes a 5% systemic efficiency penalty
    const hydrationDrag = liverAlcoholDrain[s] > 0 ? 0.95 : 1.0;
    const fatOxEfficiency = Math.max(0, (1.0 - insulinLevel) * hrvMultiplier * (1.0 + caffeineBoost) * hydrationDrag);

    // Anabolic Signal Model (MPS)
    // - Requires amino acid availability (proteinLevel)
    // - Boosted by strength training stimulus (strengthTrainingActive)
    // - Taxed by alcohol (mTOR inhibition)
    // - INTERFERENCE WINDOW: Alcohol within 4 hours (16 slots) of strength work is 2x as destructive (50% tax vs 30%)
    let currentAlcoholTax = 1.0;
    if (liverAlcoholDrain[s] > 0) {
      const windowSlots = 16; // 4 hours
      let inInterferenceWindow = false;
      for (let i = Math.max(0, s - windowSlots); i <= s; i++) {
        if (strengthSlots[i]) { inInterferenceWindow = true; break; }
      }
      currentAlcoholTax = inInterferenceWindow ? 0.5 : 0.7;
    }
    
    const trainingBoost = strengthTrainingActive ? 1.5 : 1.0;
    const anabolicSignal = Math.min(1.0, proteinLevel * trainingBoost * currentAlcoholTax);

    const burnThisSlot       = bmrPerSlot + exerciseBurnPerSlot[s];
    const absorptionThisSlot = absorptionPerSlot[s];
    const gutRemaining       = gutBySlot[s];

    const gutContribution = Math.min(absorptionThisSlot, burnThisSlot);
    let remaining         = burnThisSlot - gutContribution;

    const fatFaucetPerSlot = (alpertNumber / 24 / 4) * fatOxEfficiency;
    const fatContribution  = Math.min(remaining, fatFaucetPerSlot);
    remaining -= fatContribution;

    const currentLiverDrain = liverAlcoholDrain[s];
    const liverContribution = Math.min(remaining, liverKcal);
    liverKcal = Math.max(0, liverKcal - liverContribution - currentLiverDrain);
    const liverRefillAmt = Math.min(LIVER_MAX_KCAL - liverKcal, absorptionThisSlot * 0.06);
    liverKcal += liverRefillAmt;
    remaining -= liverContribution;

    const muscleGlycoContribution = Math.min(remaining, muscleGlycogenKcal);
    muscleGlycogenKcal = Math.max(0, muscleGlycogenKcal - muscleGlycoContribution);
    const muscleRefillAmt = Math.min(muscleMax - muscleGlycogenKcal, absorptionThisSlot * 0.15);
    muscleGlycogenKcal += muscleRefillAmt;
    remaining -= muscleGlycoContribution;

    const muscleContribution = Math.max(0, remaining);
    const fatStoredThisSlot = Math.max(0, absorptionThisSlot - burnThisSlot - liverRefillAmt - muscleRefillAmt);

    cumulativeFatBurned     += fatContribution;
    cumulativeFatStored     += fatStoredThisSlot;
    cumulativeMuscleLost    += muscleContribution;
    cumulativeGlycogenDrawn += liverContribution + muscleGlycoContribution;
    cumulativeAnabolicPotential += anabolicSignal;

    slots.push({
      slot: s,
      gutContribution:            Math.round(gutContribution),
      fatContribution:            Math.round(fatContribution),
      liverContribution:          Math.round(liverContribution),
      muscleGlycogenContribution: Math.round(muscleGlycoContribution),
      muscleContribution:         Math.round(muscleContribution),
      fatStoredThisSlot:          Math.round(fatStoredThisSlot),
      insulinLevel:               Number(insulinLevel.toFixed(2)),
      fatOxEfficiency:            Number(fatOxEfficiency.toFixed(2)),
      anabolicSignal:             Number(anabolicSignal.toFixed(2)),
      caffeineLevel:              Math.round(caffeineLevel),
      cumulativeFatBurned:        Math.round(cumulativeFatBurned),
      cumulativeFatStored:        Math.round(cumulativeFatStored),
      cumulativeMuscleLost:       Math.round(cumulativeMuscleLost),
      cumulativeGlycogenDrawn:    Math.round(cumulativeGlycogenDrawn),
      cumulativeAnabolicPotential: Number(cumulativeAnabolicPotential.toFixed(2)),
      gutKcal:                    Math.round(gutRemaining),
      liverKcal:                  Math.round(liverKcal),
      muscleGlycogenKcal:         Math.round(muscleGlycogenKcal),
      fatAllowanceRemaining:      Math.round(alpertNumber - cumulativeFatBurned),
    });
  }

  return {
    slots,
    totalFatBurned: Math.round(cumulativeFatBurned),
    totalFatStored: Math.round(cumulativeFatStored),
    totalMuscleLost: Math.round(cumulativeMuscleLost),
    totalGlycogenDrawn: Math.round(cumulativeGlycogenDrawn),
    totalOmega3Mg,
    totalAnabolicPotential: Number(cumulativeAnabolicPotential.toFixed(2)),
    muscleGlycogenMaxKcal: muscleMax,
    score: computeMetabolicScore(cumulativeFatBurned, cumulativeFatStored, cumulativeMuscleLost),
  };
}

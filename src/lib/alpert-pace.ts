/**
 * @fileOverview Alpert pace warning — is today's deficit running past the most
 * fat the body can supply in a day (the Alpert ceiling)? Past it, the rest of
 * the deficit comes from glycogen and lean tissue.
 *
 * Deliberately runs on the device burn (after the 0.90 discount) rather than the
 * score's 50%-credited burn: for a muscle-loss warning, the higher burn estimate
 * is the cautious one.
 */

export interface AlpertPaceInput {
  caloriesIn: number;      // logged so far today
  caloriesOut: number;     // device burn so far today
  alpertNumber: number;    // kcal/day fat-oxidation ceiling
  hoursElapsed: number;    // local hours since midnight
}

export interface AlpertPace {
  currentHourlyRate: number;
  hourlyBudget: number;
  projectedDaily: number;
  /** Projected deficit past the ceiling — the part that can't come from fat. */
  projectedBeyondAlpert: number;
  /** No food logged today — a fast, or food not logged yet. */
  fasted: boolean;
}

/**
 * Returns the warning, or null while the pace is sustainable. Fires when:
 *   1. the deficit so far is already ≥ 90% of the whole day's ceiling, or
 *   2. after 17:00, the projected day is ≥ 130% of the ceiling with ≥ 75% already spent.
 * A day with nothing logged still counts — a fast is exactly when this matters.
 *
 * Note: rule 2 can't fire on its own. At ≥ 17h, projecting ≥ 130% of the ceiling
 * needs a deficit ≥ 1.3 × 17/24 ≈ 92% of it, so rule 1 has already fired. Kept
 * as-is to preserve the dashboard's existing behavior.
 */
export function computeAlpertPace(input: AlpertPaceInput): AlpertPace | null {
  const { caloriesIn, caloriesOut, alpertNumber, hoursElapsed } = input;
  if (caloriesOut <= 0 || alpertNumber <= 0 || hoursElapsed <= 0) return null;

  const deficit = caloriesOut - Math.max(0, caloriesIn);
  if (deficit <= 0) return null;

  const currentHourlyRate = deficit / hoursElapsed;
  const projectedDaily = Math.round(currentHourlyRate * 24);
  const isCriticalDeficit = deficit >= alpertNumber * 0.9;
  const isLateDayBreach = hoursElapsed >= 17
    && projectedDaily >= alpertNumber * 1.3
    && deficit >= alpertNumber * 0.75;
  if (!isCriticalDeficit && !isLateDayBreach) return null;

  return {
    currentHourlyRate: Math.round(currentHourlyRate),
    hourlyBudget: Math.round(alpertNumber / 24),
    projectedDaily,
    projectedBeyondAlpert: Math.max(0, projectedDaily - alpertNumber),
    fasted: caloriesIn <= 0,
  };
}

import type { MetabolicSlotData } from './metabolic-engine';

export interface EatRunwayInput {
  caloriesIn: number;
  /** Counted burn used by v3.2 scoring (BMR + 50% above-BMR activity). */
  scoredCaloriesOut: number;
  /** Daily Alpert fat-oxidation ceiling in kcal/day. */
  alpertNumber: number;
  /** Current local hours since midnight (e.g. 13.5 for 1:30 PM). */
  hoursElapsed: number;
  /** Protein logged so far today (g). */
  proteinG: number;
  /** Daily protein target (g). */
  proteinGoal: number;
  /** Optional 15-min metabolic simulation slots (73 slots, 06:00 to 24:00). */
  slots?: MetabolicSlotData[];
}

export type EatRunwayStatus = 'clear' | 'eat_soon' | 'eat_now';

export interface EatRunway {
  status: EatRunwayStatus;
  headline: string;
  subline: string;
  // Signal 1: Intraday Fuel Tank ("Time-to-Muscle-Burn" clock)
  nowSlotIndex: number;
  liverKcalRemaining: number;
  muscleLostSoFarKcal: number;
  firstMuscleBurnSlot: number | null;
  muscleBurnStartTimeLabel: string | null;
  hoursUntilMuscleBurn: number | null;
  // Signal 2: Daily Alpert Calorie Floor & 100-Pt Target
  alpertFloorIntakeKcal: number;
  kcalToAlpertFloor: number;
  target100PtIntakeKcal: number;
  kcalLeftFor100Pts: number;
  // Signal 3: Protein Pacing Window
  proteinToGoG: number;
  mealsNeededForProtein: number;
  hoursUntilKitchenClose: number;
  proteinWindowTight: boolean;
}

const SIM_START_MIN = 6 * 60; // 06:00 AM
const SIM_INTERVAL_MIN = 15;
const KITCHEN_CLOSE_HOUR = 20.5; // 8:30 PM
const PROTEIN_PER_MEAL_CAP_G = 45;
const MEAL_SPACING_HOURS = 3;

export function slotToTimeLabel(slotIndex: number): string {
  const totalMinutes = SIM_START_MIN + slotIndex * SIM_INTERVAL_MIN;
  const normalizedMin = ((totalMinutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(normalizedMin / 60);
  const m = normalizedMin % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * 3-Signal "Should I Eat Now?" Runway:
 *   1. Intraday Fuel Tank: scans 15-min metabolic slots from now forward for the
 *      exact time liver/muscle glycogen can no longer cover the gap above the
 *      hourly Fat Faucet (`muscleContribution > 0`).
 *   2. Daily Alpert Floor & 100-Pt Target: computes minimum safe intake so total
 *      daily deficit doesn't exceed the Alpert ceiling (0 extra points, muscle risk).
 *   3. Protein Pacing Window: checks remaining protein vs. ~45g/meal synthesis
 *      bolus spacing before 8:30 PM kitchen close.
 */
export function computeEatRunway(input: EatRunwayInput): EatRunway {
  const {
    caloriesIn,
    scoredCaloriesOut,
    alpertNumber,
    hoursElapsed,
    proteinG,
    proteinGoal,
    slots,
  } = input;

  const safeCaloriesIn = Math.max(0, Math.round(caloriesIn));
  const safeScoredOut = Math.max(0, Math.round(scoredCaloriesOut));
  const safeAlpert = Math.max(1, Math.round(alpertNumber));

  // Signal 1: Intraday slot scan
  const minutesSinceMidnight = Math.round(hoursElapsed * 60);
  const rawNowSlot = Math.round((minutesSinceMidnight - SIM_START_MIN) / SIM_INTERVAL_MIN);
  const nowSlotIndex = Math.max(0, Math.min(72, rawNowSlot));

  let liverKcalRemaining = 400;
  let muscleLostSoFarKcal = 0;
  let firstMuscleBurnSlot: number | null = null;
  let muscleBurnStartTimeLabel: string | null = null;
  let hoursUntilMuscleBurn: number | null = null;

  if (slots && slots.length > 0) {
    const clampedNow = Math.max(0, Math.min(slots.length - 1, nowSlotIndex));
    const currentSlot = slots[clampedNow];
    liverKcalRemaining = Math.round(currentSlot.liverKcal);
    muscleLostSoFarKcal = Math.round(currentSlot.cumulativeMuscleLost);

    for (let s = clampedNow; s < slots.length; s++) {
      const slot = slots[s];
      // Once liver glycogen is exhausted (0 kcal) with nothing absorbing from the gut,
      // systemic glucose demand beyond the fat faucet triggers hepatic gluconeogenesis
      // (amino acid / lean tissue catabolism), even before skeletal muscle glycogen empties.
      if (slot.muscleContribution > 0.05 || (slot.liverKcal <= 0 && slot.gutContribution <= 0)) {
        firstMuscleBurnSlot = s;
        break;
      }
    }

    if (firstMuscleBurnSlot !== null) {
      muscleBurnStartTimeLabel = slotToTimeLabel(firstMuscleBurnSlot);
      const burnMin = SIM_START_MIN + firstMuscleBurnSlot * SIM_INTERVAL_MIN;
      const diffHours = (burnMin - hoursElapsed * 60) / 60;
      hoursUntilMuscleBurn = Math.max(0, Math.round(diffHours * 10) / 10);
    }
  }

  // Signal 2: Daily Alpert Calorie Floor & 100-Pt Intake Target
  const alpertFloorIntakeKcal = Math.max(0, Math.round(safeScoredOut - safeAlpert));
  const kcalToAlpertFloor = Math.max(0, alpertFloorIntakeKcal - safeCaloriesIn);
  const target100PtIntakeKcal = Math.max(0, Math.round(safeScoredOut - safeAlpert * 0.7));
  const kcalLeftFor100Pts = Math.round(target100PtIntakeKcal - safeCaloriesIn);

  // Signal 3: Protein Pacing Window
  const proteinToGoG = Math.max(0, Math.round(proteinGoal - Math.max(0, proteinG)));
  const mealsNeededForProtein = proteinToGoG <= 0 ? 0 : Math.ceil(proteinToGoG / PROTEIN_PER_MEAL_CAP_G);
  const hoursUntilKitchenClose = Math.max(0, Math.round((KITCHEN_CLOSE_HOUR - hoursElapsed) * 10) / 10);
  const minHoursNeededForProtein = Math.max(0, (mealsNeededForProtein - 1) * MEAL_SPACING_HOURS);
  const proteinWindowTight =
    proteinToGoG > PROTEIN_PER_MEAL_CAP_G &&
    (hoursUntilKitchenClose <= 0.5 || minHoursNeededForProtein >= hoursUntilKitchenClose);

  // Determine overall status & actionable coaching headline
  let status: EatRunwayStatus = 'clear';
  let headline = 'Fasting Runway Clear';
  let subline = '';

  const burningMuscleNow = hoursUntilMuscleBurn !== null && hoursUntilMuscleBurn <= 0.25;
  const burningMuscleSoon = hoursUntilMuscleBurn !== null && hoursUntilMuscleBurn > 0.25 && hoursUntilMuscleBurn <= 2.5;

  if (burningMuscleNow) {
    status = 'eat_now';
    headline = 'Eat Now — Burning Lean Tissue';
    subline = kcalToAlpertFloor > 0
      ? `Liver glycogen is tapped out. Eat at least ${kcalToAlpertFloor.toLocaleString()} kcal today to stay above your Alpert floor.`
      : `Glycogen buffer depleted (${liverKcalRemaining} kcal left). A protein/carb feeding now halts muscle catabolism.`;
  } else if (kcalToAlpertFloor > 0 && hoursUntilKitchenClose <= 2) {
    status = 'eat_now';
    headline = `Eat ${kcalToAlpertFloor.toLocaleString()} kcal — Below Alpert Floor`;
    subline = `Counted deficit exceeds your ${safeAlpert.toLocaleString()} kcal fat cap; extra deficit scores 0 pts and risks lean mass.`;
  } else if (proteinToGoG >= 90 && hoursUntilKitchenClose <= 3) {
    status = 'eat_now';
    headline = `Eat Now — ${proteinToGoG}g Protein Left`;
    subline = `Only ${hoursUntilKitchenClose}h until 8:30 PM. Start a high-protein meal now to hit ${proteinGoal}g.`;
  } else if (burningMuscleSoon && muscleBurnStartTimeLabel) {
    status = 'eat_soon';
    headline = `Break Fast by ${muscleBurnStartTimeLabel}`;
    subline = `Liver buffer (${liverKcalRemaining} kcal) covers your fat faucet for ~${hoursUntilMuscleBurn}h before lean tissue is tapped.`;
  } else if (proteinWindowTight) {
    status = 'eat_soon';
    headline = `Start Protein Window Soon (${proteinToGoG}g to go)`;
    subline = `Needs ~${mealsNeededForProtein} meals (~45g each) across the ${hoursUntilKitchenClose}h left before 8:30 PM.`;
  } else if (kcalToAlpertFloor >= 600 && hoursElapsed >= 14) {
    status = 'eat_soon';
    headline = `Plan ${kcalToAlpertFloor.toLocaleString()} kcal to Hit Alpert Floor`;
    subline = `Min safe intake today is ${alpertFloorIntakeKcal.toLocaleString()} kcal (counted burn ${safeScoredOut.toLocaleString()} − Alpert ${safeAlpert.toLocaleString()}).`;
  } else {
    status = 'clear';
    if (muscleBurnStartTimeLabel) {
      headline = `Runway Clear Until ${muscleBurnStartTimeLabel}`;
      subline = `Liver glycogen (${liverKcalRemaining} kcal) + fat faucet cover burn for another ${hoursUntilMuscleBurn}h.`;
    } else {
      headline = safeCaloriesIn === 0 ? 'Fasting Runway Clear' : 'Metabolic Pace On Track';
      subline = kcalToAlpertFloor > 0
        ? `Liver glycogen at ${liverKcalRemaining} kcal · Eat ≥${kcalToAlpertFloor.toLocaleString()} kcal before bed to clear Alpert floor.`
        : `Above Alpert floor · ${kcalLeftFor100Pts >= 0 ? `${kcalLeftFor100Pts.toLocaleString()} kcal left for a 100-pt day` : `${Math.abs(kcalLeftFor100Pts).toLocaleString()} kcal past 100-pt line`}.`;
    }
  }

  return {
    status,
    headline,
    subline,
    nowSlotIndex,
    liverKcalRemaining,
    muscleLostSoFarKcal,
    firstMuscleBurnSlot,
    muscleBurnStartTimeLabel,
    hoursUntilMuscleBurn,
    alpertFloorIntakeKcal,
    kcalToAlpertFloor,
    target100PtIntakeKcal,
    kcalLeftFor100Pts,
    proteinToGoG,
    mealsNeededForProtein,
    hoursUntilKitchenClose,
    proteinWindowTight,
  };
}


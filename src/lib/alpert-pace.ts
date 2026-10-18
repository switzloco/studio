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
  /** Current local hours since midnight (e.g. 14.5 for 2:30 PM). */
  hoursElapsed: number;
  /** Protein logged so far today (g). */
  proteinG: number;
  /** Daily protein target (g). */
  proteinGoal: number;
  /** Optional 24-hour resting BMR (kcal/day), defaults to 1750. */
  bmrKcal?: number;
  /** Optional 15-min metabolic simulation slots (73 slots, 06:00 to 24:00). */
  slots?: MetabolicSlotData[];
}

export type EatRunwayStatus = 'clear' | 'eat_soon' | 'eat_now';

export interface EatRunway {
  status: EatRunwayStatus;
  headline: string;
  subline: string;
  // Direct Alpert Breach Clock & Calorie Buffer
  currentDeficitKcal: number;
  /** Positive = kcal of burn left before hitting Alpert limit; <= 0 = kcal past Alpert limit right now. */
  kcalUntilAlpertBreach: number;
  /** Estimated current burn rate (kcal/hr). */
  hourlyBurnRateKcal: number;
  /** Hours from now until current deficit hits alpertNumber (0 if already breached). */
  hoursUntilAlpertBreach: number;
  /** Clock time when Alpert breach will occur today (e.g. "4:35 PM"), "Now" if breached, or null if after midnight. */
  alpertBreachTimeLabel: string | null;
  // Signal 1: Intraday Fuel Tank ("Time-to-Muscle-Burn" clock)
  nowSlotIndex: number;
  liverKcalRemaining: number;
  muscleLostSoFarKcal: number;
  firstMuscleBurnSlot: number | null;
  muscleBurnStartTimeLabel: string | null;
  hoursUntilMuscleBurn: number | null;
  // Signal 2: Full-Day Projected Alpert Calorie Floor & 100-Pt Target
  projectedFullDayBurnKcal: number;
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

export function hoursSinceMidnightToTimeLabel(hours: number): string {
  // Round to nearest 5 minutes for clean readability
  const roundedMin = Math.round((hours * 60) / 5) * 5;
  const normalizedMin = ((roundedMin % 1440) + 1440) % 1440;
  const h24 = Math.floor(normalizedMin / 60);
  const m = normalizedMin % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * 3-Signal "Should I Eat Now?" & Alpert Breach Runway:
 *   1. Direct Alpert Breach Clock: computes exact calories of burn remaining
 *      (`kcalUntilAlpertBreach = alpertNumber - (scoredCaloriesOut - caloriesIn)`)
 *      and clock time (`alpertBreachTimeLabel`) before today's deficit breaches
 *      the Alpert limit at your current hourly burn rate.
 *   2. End-of-Day Alpert Floor & 100-Pt Target: projects full-day burn (adding
 *      remaining hours of resting BMR when mid-day) so you know how many total
 *      calories to plan before bed.
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
    bmrKcal = 1750,
    slots,
  } = input;

  const safeCaloriesIn = Math.max(0, Math.round(caloriesIn));
  const safeScoredOut = Math.max(0, Math.round(scoredCaloriesOut));
  const safeAlpert = Math.max(1, Math.round(alpertNumber));
  const safeBmr = Math.max(1200, Math.round(bmrKcal));

  // Direct Alpert Breach Clock (calories & time until current deficit hits alpertNumber)
  const bmrHourly = safeBmr / 24;
  const effectiveHours = Math.max(1, Math.min(24, hoursElapsed));
  const observedHourly = safeScoredOut / effectiveHours;
  const hourlyBurnRateKcal = Math.max(
    Math.round(bmrHourly),
    Math.min(Math.round(observedHourly), Math.round(bmrHourly * 2.5))
  );

  const currentDeficitKcal = safeScoredOut - safeCaloriesIn;
  const kcalUntilAlpertBreach = safeAlpert - currentDeficitKcal;

  let hoursUntilAlpertBreach = 0;
  let alpertBreachTimeLabel: string | null = null;

  if (kcalUntilAlpertBreach <= 0) {
    hoursUntilAlpertBreach = 0;
    alpertBreachTimeLabel = 'Now';
  } else {
    const rawHoursToBreach = kcalUntilAlpertBreach / Math.max(1, hourlyBurnRateKcal);
    hoursUntilAlpertBreach = Math.max(0.1, Math.round(rawHoursToBreach * 10) / 10);
    const breachHourOfDay = hoursElapsed + rawHoursToBreach;
    if (breachHourOfDay < 24) {
      alpertBreachTimeLabel = hoursSinceMidnightToTimeLabel(breachHourOfDay);
    } else {
      alpertBreachTimeLabel = null; // Safe past midnight
    }
  }

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

  // Signal 2: Projected Full-Day Burn & End-of-Day Alpert Floor / 100-Pt Intake Target
  // Mid-day wearable burn only reflects calories burned so far; add remaining resting BMR
  // up to midnight so the daily intake target reflects the full 24h day.
  const remainingDayHours = hoursElapsed < 23.5 ? Math.max(0, 24 - hoursElapsed) : 0;
  const projectedFullDayBurnKcal =
    remainingDayHours > 0
      ? Math.max(safeScoredOut, safeBmr, Math.round(safeScoredOut + bmrHourly * remainingDayHours))
      : safeScoredOut;

  const alpertFloorIntakeKcal = Math.max(0, Math.round(projectedFullDayBurnKcal - safeAlpert));
  const kcalToAlpertFloor = Math.max(0, alpertFloorIntakeKcal - safeCaloriesIn);
  const target100PtIntakeKcal = Math.max(0, Math.round(projectedFullDayBurnKcal - safeAlpert * 0.7));
  const kcalLeftFor100Pts = Math.round(target100PtIntakeKcal - safeCaloriesIn);

  // Signal 3: Protein Pacing Window
  const proteinToGoG = Math.max(0, Math.round(proteinGoal - Math.max(0, proteinG)));
  const mealsNeededForProtein = proteinToGoG <= 0 ? 0 : Math.ceil(proteinToGoG / PROTEIN_PER_MEAL_CAP_G);
  const hoursUntilKitchenClose = Math.max(0, Math.round((KITCHEN_CLOSE_HOUR - hoursElapsed) * 10) / 10);
  const minHoursNeededForProtein = Math.max(0, (mealsNeededForProtein - 1) * MEAL_SPACING_HOURS);
  const proteinWindowTight =
    proteinToGoG > PROTEIN_PER_MEAL_CAP_G &&
    (hoursUntilKitchenClose <= 0.5 || minHoursNeededForProtein >= hoursUntilKitchenClose);

  // Determine overall status & actionable coaching headline focused on Alpert Breach
  let status: EatRunwayStatus = 'clear';
  let headline = 'Alpert Runway Clear';
  let subline = '';

  const breachedNow = kcalUntilAlpertBreach <= 0;
  const burningMuscleNow = hoursUntilMuscleBurn !== null && hoursUntilMuscleBurn <= 0.25;
  const breachingSoon =
    !breachedNow &&
    alpertBreachTimeLabel !== null &&
    hoursUntilAlpertBreach <= 2.5;

  if (breachedNow) {
    status = 'eat_now';
    const overBy = Math.abs(kcalUntilAlpertBreach);
    headline =
      overBy > 0
        ? `Alpert Limit Breached by ${overBy.toLocaleString()} kcal — Eat Now`
        : 'At Alpert Limit Now — Time to Eat';
    subline = `Current deficit (${currentDeficitKcal.toLocaleString()} kcal) is past your ${safeAlpert.toLocaleString()} kcal fat cap. Eat ≥${Math.max(overBy, 150).toLocaleString()} kcal now to stop lean-mass draw, and ≥${kcalToAlpertFloor.toLocaleString()} kcal more before bed.`;
  } else if (burningMuscleNow) {
    status = 'eat_now';
    headline = `Eat Now — ${kcalUntilAlpertBreach.toLocaleString()} kcal Until Alpert Breach`;
    subline = `Glycogen buffer is tapped out and you are ~${hoursUntilAlpertBreach}h from breaching your ${safeAlpert.toLocaleString()} kcal Alpert cap. Plan ≥${kcalToAlpertFloor.toLocaleString()} kcal before bed.`;
  } else if (breachingSoon && alpertBreachTimeLabel) {
    status = 'eat_soon';
    headline = `Plan to Eat by ${alpertBreachTimeLabel} (~${hoursUntilAlpertBreach}h) · ${kcalUntilAlpertBreach.toLocaleString()} kcal Left`;
    subline = `Burning ~${hourlyBurnRateKcal} kcal/hr — deficit (${currentDeficitKcal.toLocaleString()} / ${safeAlpert.toLocaleString()} kcal) hits Alpert breach at ${alpertBreachTimeLabel}. Eat ≥${kcalToAlpertFloor.toLocaleString()} kcal more today.`;
  } else if (proteinWindowTight) {
    status = 'eat_soon';
    headline = alpertBreachTimeLabel
      ? `Eat by ${alpertBreachTimeLabel} (${kcalUntilAlpertBreach.toLocaleString()} kcal left) · ${proteinToGoG}g Protein Left`
      : `Start Protein Window Soon (${proteinToGoG}g to go)`;
    subline = `Needs ~${mealsNeededForProtein} meals (~45g each) across the ${hoursUntilKitchenClose}h left before 8:30 PM · Plan ≥${kcalToAlpertFloor.toLocaleString()} kcal more before bed.`;
  } else if (alpertBreachTimeLabel) {
    status = 'clear';
    headline = `Plan to Eat by ${alpertBreachTimeLabel} (~${hoursUntilAlpertBreach}h) · ${kcalUntilAlpertBreach.toLocaleString()} kcal to Breach`;
    subline = `Deficit is ${currentDeficitKcal.toLocaleString()} / ${safeAlpert.toLocaleString()} kcal (~${hourlyBurnRateKcal} kcal/hr). Plan ≥${kcalToAlpertFloor.toLocaleString()} kcal more today (${kcalLeftFor100Pts.toLocaleString()} kcal for a 100-pt day).`;
  } else {
    status = 'clear';
    headline = `Safe Through Midnight · ${kcalUntilAlpertBreach.toLocaleString()} kcal Buffer Left`;
    subline =
      kcalToAlpertFloor > 0
        ? `Deficit is ${currentDeficitKcal.toLocaleString()} / ${safeAlpert.toLocaleString()} kcal · Eat ≥${kcalToAlpertFloor.toLocaleString()} kcal before bed to stay above EOD Alpert floor.`
        : `Full-day Alpert floor (${alpertFloorIntakeKcal.toLocaleString()} kcal) cleared ✓ · ${kcalLeftFor100Pts >= 0 ? `${kcalLeftFor100Pts.toLocaleString()} kcal left for a 100-pt day` : `${Math.abs(kcalLeftFor100Pts).toLocaleString()} kcal past 100-pt line`}.`;
  }

  return {
    status,
    headline,
    subline,
    currentDeficitKcal,
    kcalUntilAlpertBreach,
    hourlyBurnRateKcal,
    hoursUntilAlpertBreach,
    alpertBreachTimeLabel,
    nowSlotIndex,
    liverKcalRemaining,
    muscleLostSoFarKcal,
    firstMuscleBurnSlot,
    muscleBurnStartTimeLabel,
    hoursUntilMuscleBurn,
    projectedFullDayBurnKcal,
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


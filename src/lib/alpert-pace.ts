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
  /**
   * Optional net deficit carried over from yesterday at midnight (kcal).
   * Keeps the expected Alpert breach time 100% continuous across midnight when
   * waking up fasted the next morning, decaying to 0 once you eat (~350+ kcal).
   */
  prevDayDeficitKcal?: number;
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
  /** Portion of currentDeficitKcal carried over from yesterday's unbroken overnight fast (0 once fed). */
  overnightCarryoverKcal: number;
  /** Projected end-of-day deficit at midnight tonight (used as tomorrow morning's carryover). */
  projectedMidnightDeficitKcal: number;
  /** Positive = kcal of burn left before hitting Alpert limit; <= 0 = kcal past Alpert limit right now. */
  kcalUntilAlpertBreach: number;
  /** Estimated current waking burn rate (kcal/hr). */
  hourlyBurnRateKcal: number;
  /** Estimated overnight sleeping burn rate (kcal/hr, resting BMR). */
  overnightBurnRateKcal: number;
  /** Hours from now until current deficit hits alpertNumber (0 if already breached). Uses waking rate + overnight BMR sleep rate. */
  hoursUntilAlpertBreach: number;
  /** Clock time when Alpert breach will occur today (e.g. "4:35 PM"), "Now" if breached, or null if after midnight. */
  alpertBreachTimeLabel: string | null;
  /** Always-present expected breach clock time across midnight/tomorrow (e.g. "Today 4:35 PM", "Tomorrow 10:00 AM", "Now"). */
  expectedBreachTimeLabel: string;
  /** Whether current calorie buffer safely carries through 8:00 AM wake-up tomorrow without breaching Alpert limit. */
  safeThrough8amTomorrow: boolean;
  /** Projected kcal of Alpert buffer remaining at 8:00 AM tomorrow (negative = kcal short of 8:00 AM wake-up). */
  kcalBufferAt8amTomorrow: number;
  /** Calories needed before bed to reach 8:00 AM wake-up tomorrow without breaching Alpert limit (0 if already safe). */
  kcalNeededFor8amTomorrow: number;
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
const SLEEP_START_HOUR = 23; // 11:00 PM bedtime transition to resting BMR
const WAKE_UP_HOUR = 8; // 8:00 AM wake-up horizon
const TOMORROW_WAKE_HOUR = 24 + WAKE_UP_HOUR; // 32.0h from today's midnight
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
 * Formats an absolute hour offset from today's midnight (e.g. 16.3 -> "Today 4:20 PM",
 * 32.8 -> "Tomorrow 8:50 AM", 50.0 -> "In 2d (2:00 AM)").
 */
export function formatMultiDayBreachTime(breachHourFromTodayMidnight: number): string {
  const clockLabel = hoursSinceMidnightToTimeLabel(breachHourFromTodayMidnight);
  if (breachHourFromTodayMidnight < 24) {
    return `Today ${clockLabel}`;
  }
  if (breachHourFromTodayMidnight < 48) {
    return `Tomorrow ${clockLabel}`;
  }
  const daysOut = Math.floor(breachHourFromTodayMidnight / 24);
  return `In ${daysOut}d (${clockLabel})`;
}

/**
 * Piecewise circadian burn projection:
 * - Waking hours (08:00 to 23:00): burns at `wakingRateKcal`
 * - Overnight sleep hours (23:00 to 08:00): burns at `sleepRateKcal` (resting BMR)
 */
function isSleepHourOfDay(hourMod24: number): boolean {
  return hourMod24 >= SLEEP_START_HOUR || hourMod24 < WAKE_UP_HOUR;
}

function nextCircadianBoundaryHour(currentHour: number): number {
  const dayBase = Math.floor(currentHour / 24) * 24;
  const hMod = currentHour - dayBase;
  if (hMod < WAKE_UP_HOUR) return dayBase + WAKE_UP_HOUR;
  if (hMod < SLEEP_START_HOUR) return dayBase + SLEEP_START_HOUR;
  return dayBase + 24 + WAKE_UP_HOUR;
}

export function computeBurnBetweenHours(
  startHour: number,
  endHour: number,
  wakingRateKcal: number,
  sleepRateKcal: number
): number {
  if (endHour <= startHour) return 0;
  let cursor = startHour;
  let totalBurn = 0;
  let guard = 0;
  while (cursor < endHour && guard < 20) {
    guard++;
    const nextBoundary = Math.min(endHour, nextCircadianBoundaryHour(cursor));
    const dt = Math.max(0, nextBoundary - cursor);
    const hMod = ((cursor % 24) + 24) % 24;
    const rate = isSleepHourOfDay(hMod) ? sleepRateKcal : wakingRateKcal;
    totalBurn += dt * rate;
    cursor = nextBoundary;
  }
  return totalBurn;
}

function projectHoursUntilAlpertBreach(
  startHour: number,
  kcalBuffer: number,
  wakingRateKcal: number,
  sleepRateKcal: number
): number {
  if (kcalBuffer <= 0) return 0;
  let cursor = startHour;
  let remainingKcal = kcalBuffer;
  let guard = 0;
  while (remainingKcal > 0 && guard < 30) {
    guard++;
    const nextBoundary = nextCircadianBoundaryHour(cursor);
    const segHours = Math.max(0.01, nextBoundary - cursor);
    const hMod = ((cursor % 24) + 24) % 24;
    const rate = Math.max(1, isSleepHourOfDay(hMod) ? sleepRateKcal : wakingRateKcal);
    const segBurn = segHours * rate;
    if (remainingKcal <= segBurn) {
      cursor += remainingKcal / rate;
      remainingKcal = 0;
      break;
    }
    remainingKcal -= segBurn;
    cursor = nextBoundary;
  }
  return Math.max(0.1, cursor - startHour);
}

/**
 * 3-Signal "Should I Eat Now?" & Alpert Breach Runway:
 *   1. Direct Alpert Breach Clock (with 8:00 AM Tomorrow Wake-Up Horizon & Overnight Fast Carryover):
 *      computes exact calories of burn remaining (`kcalUntilAlpertBreach`) and
 *      projects the exact expected breach clock time across midnight and overnight
 *      sleep (`expectedBreachTimeLabel`, e.g., "Tomorrow 10:00 AM"). When waking up
 *      fasted the next morning, `prevDayDeficitKcal` carries over until you eat so
 *      the morning breach time matches last night's prediction without jumping at midnight.
 *   2. End-of-Day Alpert Floor & 100-Pt Target: projects full-day burn so you know
 *      how many total calories to plan before bed.
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
    prevDayDeficitKcal = 0,
    slots,
  } = input;

  const safeCaloriesIn = Math.max(0, Math.round(caloriesIn));
  const safeScoredOut = Math.max(0, Math.round(scoredCaloriesOut));
  const safeAlpert = Math.max(1, Math.round(alpertNumber));
  const safeBmr = Math.max(1200, Math.round(bmrKcal));

  // Direct Alpert Breach Clock (calories & time until current deficit hits alpertNumber)
  const bmrHourly = safeBmr / 24;
  const overnightBurnRateKcal = Math.round(bmrHourly);
  const effectiveHours = Math.max(1, Math.min(24, hoursElapsed));
  const observedHourly = safeScoredOut / effectiveHours;

  // Early morning (before 11:00 AM), 00:00-08:00 was sleep at BMR, so observedHourly
  // reflects sleep rather than daytime waking pace. Use a 1.28x BMR waking floor (~94 kcal/hr)
  // when carrying over an overnight fast so morning waking projection matches last night's.
  const wakingFloorRate =
    prevDayDeficitKcal > 0 && hoursElapsed < 11
      ? Math.round(bmrHourly * 1.28)
      : overnightBurnRateKcal;

  const hourlyBurnRateKcal = Math.max(
    wakingFloorRate,
    Math.min(Math.round(observedHourly), Math.round(bmrHourly * 2.5))
  );

  // Overnight Fast Carryover:
  // - When fasted (caloriesIn == 0), 100% of yesterday's midnight deficit carries over so
  //   waking up at 8:00 AM shows the exact same ~10:00 AM breach time predicted the night before.
  // - As you log meals today, each calorie eaten pays down the overnight fast carryover by 2.5x
  //   (clearing completely once you've eaten ~350+ kcal or after 6:00 PM).
  const clampedPrevDeficit = Math.max(0, Math.min(safeAlpert, Math.round(prevDayDeficitKcal)));
  const overnightCarryoverKcal =
    clampedPrevDeficit > 0 && hoursElapsed < 18
      ? Math.max(0, Math.round(clampedPrevDeficit - safeCaloriesIn * 2.5))
      : 0;

  const todayOnlyDeficitKcal = safeScoredOut - safeCaloriesIn;
  const currentDeficitKcal = todayOnlyDeficitKcal + overnightCarryoverKcal;
  const kcalUntilAlpertBreach = safeAlpert - currentDeficitKcal;

  // Project burn from now until Midnight (24.0h) and Tomorrow 8:00 AM (32.0h)
  const clampedStartHour = Math.max(0, Math.min(24, hoursElapsed));
  const burnToMidnight = computeBurnBetweenHours(
    clampedStartHour,
    24,
    hourlyBurnRateKcal,
    bmrHourly
  );
  const projectedMidnightDeficitKcal = Math.round(todayOnlyDeficitKcal + burnToMidnight);

  const burnTo8amTomorrow = computeBurnBetweenHours(
    clampedStartHour,
    TOMORROW_WAKE_HOUR,
    hourlyBurnRateKcal,
    bmrHourly
  );
  // 8:00 AM Tomorrow buffer is always evaluated on today's full-day deficit into tomorrow morning
  const kcalBufferAt8amTomorrow = Math.round((safeAlpert - todayOnlyDeficitKcal) - burnTo8amTomorrow);
  const safeThrough8amTomorrow = kcalBufferAt8amTomorrow >= 0;
  const kcalNeededFor8amTomorrow = Math.max(0, -kcalBufferAt8amTomorrow);

  let hoursUntilAlpertBreach = 0;
  let alpertBreachTimeLabel: string | null = null;
  let expectedBreachTimeLabel = 'Now';

  if (kcalUntilAlpertBreach <= 0) {
    hoursUntilAlpertBreach = 0;
    alpertBreachTimeLabel = 'Now';
    expectedBreachTimeLabel = 'Now';
  } else {
    const rawHoursToBreach = projectHoursUntilAlpertBreach(
      clampedStartHour,
      kcalUntilAlpertBreach,
      hourlyBurnRateKcal,
      bmrHourly
    );
    hoursUntilAlpertBreach = Math.max(0.1, Math.round(rawHoursToBreach * 10) / 10);
    const breachHourOfDay = clampedStartHour + rawHoursToBreach;
    expectedBreachTimeLabel = formatMultiDayBreachTime(breachHourOfDay);
    if (breachHourOfDay < 24) {
      alpertBreachTimeLabel = hoursSinceMidnightToTimeLabel(breachHourOfDay);
    } else {
      alpertBreachTimeLabel = null; // Past midnight (use expectedBreachTimeLabel for tomorrow's clock time)
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
  const remainingDayHours = hoursElapsed < 23.5 ? Math.max(0, 24 - hoursElapsed) : 0;
  const projectedFullDayBurnKcal =
    remainingDayHours > 0
      ? Math.max(safeScoredOut, safeBmr, Math.round(safeScoredOut + burnToMidnight))
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

  // Determine overall status & actionable coaching headline focused on Alpert Breach + 8:00 AM Wake-Up
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
    subline =
      overnightCarryoverKcal > 0
        ? `Unbroken overnight fast deficit (${currentDeficitKcal.toLocaleString()} kcal incl. yesterday) is past your ${safeAlpert.toLocaleString()} kcal cap. Eat a high-protein meal now to reset today's runway.`
        : `Current deficit (${currentDeficitKcal.toLocaleString()} kcal) is past your ${safeAlpert.toLocaleString()} kcal fat cap. Eat ≥${Math.max(overBy, 150).toLocaleString()} kcal now (or ≥${kcalNeededFor8amTomorrow.toLocaleString()} kcal to cover through 8:00 AM wake-up).`;
  } else if (burningMuscleNow) {
    status = 'eat_now';
    headline = `Eat Now — ${kcalUntilAlpertBreach.toLocaleString()} kcal Until Alpert Breach`;
    subline = `Glycogen buffer is tapped out and expected Alpert breach is ${expectedBreachTimeLabel} (~${hoursUntilAlpertBreach}h). Eat ≥${kcalNeededFor8amTomorrow.toLocaleString()} kcal to stay clear through 8:00 AM wake-up.`;
  } else if (breachingSoon && alpertBreachTimeLabel) {
    status = 'eat_soon';
    headline = `Plan to Eat by ${alpertBreachTimeLabel} (~${hoursUntilAlpertBreach}h) · ${kcalUntilAlpertBreach.toLocaleString()} kcal Left`;
    subline =
      overnightCarryoverKcal > 0
        ? `Continuing overnight fast (${currentDeficitKcal.toLocaleString()} / ${safeAlpert.toLocaleString()} kcal incl. yesterday's ${overnightCarryoverKcal.toLocaleString()} kcal deficit). Eat by ${alpertBreachTimeLabel} to refuel and reset today's runway.`
        : `Burning ~${hourlyBurnRateKcal} kcal/hr — deficit (${currentDeficitKcal.toLocaleString()} / ${safeAlpert.toLocaleString()} kcal) breaches at ${expectedBreachTimeLabel}. Eat ≥${kcalToAlpertFloor.toLocaleString()} kcal today (≥${kcalNeededFor8amTomorrow.toLocaleString()} kcal for 8:00 AM wake-up).`;
  } else if (proteinWindowTight) {
    status = 'eat_soon';
    headline = alpertBreachTimeLabel
      ? `Eat by ${alpertBreachTimeLabel} (${kcalUntilAlpertBreach.toLocaleString()} kcal left) · ${proteinToGoG}g Protein Left`
      : `Start Protein Window Soon (${proteinToGoG}g to go) · Breach ${expectedBreachTimeLabel}`;
    subline = `Needs ~${mealsNeededForProtein} meals (~45g each) across the ${hoursUntilKitchenClose}h left before 8:30 PM · Expected Alpert breach: ${expectedBreachTimeLabel}.`;
  } else if (alpertBreachTimeLabel) {
    status = 'clear';
    headline = `Plan to Eat by ${alpertBreachTimeLabel} (~${hoursUntilAlpertBreach}h) · ${kcalUntilAlpertBreach.toLocaleString()} kcal to Breach`;
    subline =
      overnightCarryoverKcal > 0
        ? `Includes ${overnightCarryoverKcal.toLocaleString()} kcal overnight fast carryover from yesterday (~${hourlyBurnRateKcal} kcal/hr). Logging your first meal clears overnight debt.`
        : `Deficit is ${currentDeficitKcal.toLocaleString()} / ${safeAlpert.toLocaleString()} kcal (~${hourlyBurnRateKcal} kcal/hr). Eat ≥${kcalToAlpertFloor.toLocaleString()} kcal for midnight floor, or ≥${kcalNeededFor8amTomorrow.toLocaleString()} kcal to clear 8:00 AM wake-up.`;
  } else if (safeThrough8amTomorrow) {
    status = 'clear';
    headline = `Safe Past 8:00 AM Wake-Up · Est. Breach ${expectedBreachTimeLabel}`;
    subline = `${kcalUntilAlpertBreach.toLocaleString()} kcal buffer left (~${hoursUntilAlpertBreach}h) — wakes at 8:00 AM with +${kcalBufferAt8amTomorrow.toLocaleString()} kcal buffer to spare. ${
      kcalLeftFor100Pts >= 0
        ? `${kcalLeftFor100Pts.toLocaleString()} kcal left for a 100-pt day.`
        : `${Math.abs(kcalLeftFor100Pts).toLocaleString()} kcal past 100-pt line.`
    }`;
  } else {
    status = 'clear';
    headline = `Safe Through Midnight · Est. Breach ${expectedBreachTimeLabel} (~${hoursUntilAlpertBreach}h)`;
    subline = `${kcalUntilAlpertBreach.toLocaleString()} kcal buffer clears midnight, but breaches before 8:00 AM wake-up. Eat ≥${kcalNeededFor8amTomorrow.toLocaleString()} kcal before bed to stay safe until 8:00 AM.`;
  }

  return {
    status,
    headline,
    subline,
    currentDeficitKcal,
    overnightCarryoverKcal,
    projectedMidnightDeficitKcal,
    kcalUntilAlpertBreach,
    hourlyBurnRateKcal,
    overnightBurnRateKcal,
    hoursUntilAlpertBreach,
    alpertBreachTimeLabel,
    expectedBreachTimeLabel,
    safeThrough8amTomorrow,
    kcalBufferAt8amTomorrow,
    kcalNeededFor8amTomorrow,
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

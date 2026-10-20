/**
 * @fileOverview Alpert & Glycogen Timing Engine + Zero-AI 3-Day Nutritionist.
 *
 * Models Seymour Alpert's (2005) maximal lipolytic energy transfer rate (~31 kcal/lb fat/day,
 * i.e. `alpertNumber / 24` kcal/hr or `alpertNumber / 1440` kcal/min) across two horizons:
 *   1. Real-Time Hepatic Glycogen + 4h Glucogenic Amino Acid Runway (respecting that skeletal
 *      muscle glycogen lacks glucose-6-phosphatase and cannot fuel the brain or resting BMR).
 *   2. Rolling 24-Hour Alpert Energy Balance Cap + 8:00 AM Tomorrow Wake-Up Horizon.
 *   3. Zero-AI 3-Day Nutritionist Prescription (0 LLM tokens): audits the last 3 days of
 *      intake & output + today's meal timestamps/macros to recommend the exact "Sweet Spot"
 *      window ("Fast Until X for Peak Fat Burn -> Eat By Y to Prevent Catabolism").
 */

import type { MetabolicSlotData } from './metabolic-engine';
import type { FoodLogEntry } from './food-exercise-types';

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

export interface RecentDaySummary {
  isoDate?: string;
  date?: string;
  caloriesIn: number;
  scoredCaloriesOut: number;
  deficit?: number;
  proteinG?: number;
  carbsG?: number;
  alcoholDrinks?: number;
  vfScore?: number;
  score?: number;
}

export interface ZeroAiNutritionistRx {
  daysAnalyzed: number;
  threeDayAvgInKcal: number;
  threeDayAvgOutKcal: number;
  threeDayAvgDeficitKcal: number;
  threeDayAvgScore: number | null;
  cutIntensity: 'deep_cut' | 'steady_cut' | 'recharged';
  /** Calibrated usable hepatic glycogen at 8:00 AM wake-up based on 3-day deficit history (kcal). */
  morningUsableLiverKcal: number;
  /** Waking energy rate that CANNOT come from the fat faucet: max(0, wakingBurn - fatFaucet) + 15 kcal/hr CNS glucose. */
  wakingNonFatGapHourlyKcal: number;
  /** Remaining usable hepatic glycogen + active meal/glucogenic amino acid buffer right now (kcal). */
  usableNonFatBufferKcal: number;
  /** Current adipose fat-oxidation faucet efficiency (0-100%, suppressed briefly by post-meal insulin). */
  fatFaucetEfficiencyPct: number;
  /** "Active Now (100%)" when fat faucet is >=85% open, or clock time when post-meal insulin clears. */
  fatPeakTimeLabel: string;
  /** Optimal clock time to eat next so hepatic glycogen + amino shield never hit catabolism (e.g. "Today 10:15 AM"). */
  optimalEatByTimeLabel: string;
  /** Hours from now until the optimal hepatic/amino anti-catabolic eat window. */
  hoursUntilOptimalEat: number;
  /** Hours of additional fat-burning runway gained by logging a ~40g lean protein (PSMF) pulse (~200 kcal). */
  psmfPulseGainHours: number;
  /** Summary of the last 3 days intake/output. */
  threeDaySummaryLabel: string;
  /** Dual-horizon sweet-spot window summary ("Fast Until X · Eat By Y"). */
  sweetSpotWindowLabel: string;
  /** Concrete 0-token nutritionist recommendation tailored to the user's current state. */
  recommendation: string;
}

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
  /** Optional today's food logs (for exact meal timing, insulin clearance, and protein shield duration). */
  foodLogs?: FoodLogEntry[];
  /** Optional last 3 completed days of intake & output for the Zero-AI Nutritionist audit. */
  recentDays?: RecentDaySummary[];
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
  /** Real-time Alpert fat oxidation faucet rate (kcal/min, i.e., alpertNumber / 1440). */
  fatFaucetPerMinKcal: number;
  /** Real-time Alpert fat oxidation faucet rate (kcal/hr, i.e., alpertNumber / 24). */
  fatFaucetHourlyKcal: number;
  /** Current waking burn rate (kcal/min). */
  wakingBurnPerMinKcal: number;
  /** Estimated current waking burn rate (kcal/hr). */
  hourlyBurnRateKcal: number;
  /** Estimated overnight sleeping burn rate (kcal/hr, resting BMR). */
  overnightBurnRateKcal: number;
  /**
   * Net buffer drain rate during post-midnight sleep (kcal/hr) after the minute-by-minute
   * Alpert fat faucet (~1.20 kcal/min) covers ~80% of sleeping BMR (~1.23 kcal/min).
   */
  overnightNetDrainHourlyKcal: number;
  /** Hours from now until current deficit hits alpertNumber (0 if already breached). Uses waking rate + overnight net sleep drain. */
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
  // Signal 4: Zero-AI 3-Day Nutritionist & Dual-Horizon Sweet-Spot Rx
  nutritionistRx: ZeroAiNutritionistRx;
}

const SIM_START_MIN = 6 * 60; // 06:00 AM
const SIM_INTERVAL_MIN = 15;
const KITCHEN_CLOSE_HOUR = 20.5; // 8:30 PM
const SLEEP_START_HOUR = 23; // 11:00 PM bedtime transition to resting BMR
const WAKE_UP_HOUR = 8; // 8:00 AM wake-up horizon
const TOMORROW_WAKE_HOUR = 24 + WAKE_UP_HOUR; // 32.0h from today's midnight
const PROTEIN_PER_MEAL_CAP_G = 45;
const MEAL_SPACING_HOURS = 3;
const CNS_OBLIGATE_NET_HOURLY_KCAL = 15; // ~110g/d brain glucose net of glycerol from lipolysis
const MAX_USABLE_HEPATIC_GUT_BUFFER_KCAL = 420; // Max post-absorptive hepatic glycogen + active amino shield

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
  if (hMod < 24) return dayBase + 24;
  return dayBase + 24 + WAKE_UP_HOUR;
}

export function computeBurnBetweenHours(
  startHour: number,
  endHour: number,
  wakingRateKcal: number,
  sleepRateKcal: number,
  postMidnightSleepRateKcal: number = sleepRateKcal
): number {
  if (endHour <= startHour) return 0;
  let cursor = startHour;
  let totalBurn = 0;
  let guard = 0;
  while (cursor < endHour && guard < 25) {
    guard++;
    const nextBoundary = Math.min(endHour, nextCircadianBoundaryHour(cursor));
    const dt = Math.max(0, nextBoundary - cursor);
    const hMod = ((cursor % 24) + 24) % 24;
    const isSleep = isSleepHourOfDay(hMod);
    const rate = isSleep
      ? cursor >= 24
        ? postMidnightSleepRateKcal
        : sleepRateKcal
      : wakingRateKcal;
    totalBurn += dt * rate;
    cursor = nextBoundary;
  }
  return totalBurn;
}

function projectHoursUntilAlpertBreach(
  startHour: number,
  kcalBuffer: number,
  wakingRateKcal: number,
  sleepRateKcal: number,
  postMidnightSleepRateKcal: number = sleepRateKcal
): number {
  if (kcalBuffer <= 0) return 0;
  let cursor = startHour;
  let remainingKcal = kcalBuffer;
  let guard = 0;
  while (remainingKcal > 0 && guard < 35) {
    guard++;
    const nextBoundary = nextCircadianBoundaryHour(cursor);
    const segHours = Math.max(0.01, nextBoundary - cursor);
    const hMod = ((cursor % 24) + 24) % 24;
    const isSleep = isSleepHourOfDay(hMod);
    const rate = Math.max(
      1,
      isSleep
        ? cursor >= 24
          ? postMidnightSleepRateKcal
          : sleepRateKcal
        : wakingRateKcal
    );
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

function parseFoodHour(food: FoodLogEntry): number {
  if (food.consumedAt) {
    const [h, m] = food.consumedAt.split(':').map(Number);
    return (h || 0) + (m || 0) / 60;
  }
  if (food.meal === 'breakfast') return 8.5;
  if (food.meal === 'lunch') return 12.5;
  if (food.meal === 'snack') return 15.5;
  return 18.5;
}

/**
 * 3-Signal + Zero-AI 3-Day Nutritionist Alpert & Glycogen Timing Engine:
 *   1. Direct Alpert Breach Clock (with Minute-by-Minute Fat Faucet & 8:00 AM Wake-Up Horizon)
 *   2. End-of-Day Alpert Floor & 100-Pt Target
 *   3. Protein Pacing Window
 *   4. Zero-AI 3-Day Nutritionist & Dual-Horizon Sweet-Spot Rx (Hepatic Glycogen + 4h Amino Shield
 *      vs. 1.20 kcal/min Fat Faucet, with 0 LLM tokens).
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
    foodLogs,
    recentDays,
  } = input;

  const safeCaloriesIn = Math.max(0, Math.round(caloriesIn));
  const safeScoredOut = Math.max(0, Math.round(scoredCaloriesOut));
  const safeAlpert = Math.max(1, Math.round(alpertNumber));
  const safeBmr = Math.max(1200, Math.round(bmrKcal));

  // Minute-by-minute & hourly fat faucet vs metabolic burn rates
  const alpertHourly = safeAlpert / 24;
  const fatFaucetHourlyKcal = Math.round(alpertHourly);
  const fatFaucetPerMinKcal = Math.round((safeAlpert / 1440) * 100) / 100;

  const bmrHourly = safeBmr / 24;
  const overnightBurnRateKcal = Math.round(bmrHourly);
  const effectiveHours = Math.max(1, Math.min(24, hoursElapsed));
  const observedHourly = safeScoredOut / effectiveHours;

  // During post-midnight sleep (00:00-08:00), the new day's fat faucet (alpertHourly)
  // oxidizes fat minute-by-minute alongside sleeping BMR (bmrHourly), covering ~80% of
  // sleep burn in real time. Only the obligate CNS glucose trickle (~20% of BMR) plus any
  // gap where BMR exceeds the fat faucet drains your remaining Alpert/glycogen buffer.
  const overnightNetDrainHourly = Math.max(
    bmrHourly * 0.2,
    bmrHourly - alpertHourly + bmrHourly * 0.18
  );
  const overnightNetDrainHourlyKcal = Math.round(overnightNetDrainHourly);
  const sleepFatFaucetHourly = Math.max(0, bmrHourly - overnightNetDrainHourly);

  // Early morning (before 11:00 AM), 00:00-08:00 was sleep at BMR, so observedHourly
  // reflects sleep rather than daytime waking pace. Use a 1.32x BMR waking floor (~97 kcal/hr)
  // when carrying over an overnight fast so morning waking projection matches last night's.
  const wakingFloorRate =
    prevDayDeficitKcal > 0 && hoursElapsed < 11
      ? Math.round(bmrHourly * 1.32)
      : overnightBurnRateKcal;

  const hourlyBurnRateKcal = Math.max(
    wakingFloorRate,
    Math.min(Math.round(observedHourly), Math.round(bmrHourly * 2.5))
  );
  const wakingBurnPerMinKcal = Math.round((hourlyBurnRateKcal / 60) * 100) / 100;

  // Overnight Fast Carryover (with minute-by-minute sleep fat-faucet credit):
  const clampedPrevDeficit = Math.max(0, Math.min(safeAlpert, Math.round(prevDayDeficitKcal)));
  const sleepHoursElapsedToday = Math.max(0, Math.min(WAKE_UP_HOUR, hoursElapsed));
  const sleepFatCoveredTodayKcal = Math.round(sleepHoursElapsedToday * sleepFatFaucetHourly);
  const rawMorningCarryover = Math.max(0, clampedPrevDeficit - sleepFatCoveredTodayKcal);
  const overnightCarryoverKcal =
    rawMorningCarryover > 0 && hoursElapsed < 18
      ? Math.max(0, Math.round(rawMorningCarryover - safeCaloriesIn * 2.5))
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
    bmrHourly,
    overnightNetDrainHourly
  );
  const projectedMidnightDeficitKcal = Math.round(todayOnlyDeficitKcal + burnToMidnight);

  // 8:00 AM Tomorrow buffer uses the exact integer midnight deficit + 8h net sleep drain
  // so that waking up at 8:00 AM with `prevDayDeficitKcal = projectedMidnightDeficitKcal`
  // produces the exact same calorie buffer with zero rounding drift.
  const overnight8hGrossSleepKcal = Math.round(WAKE_UP_HOUR * bmrHourly);
  const overnight8hFatCoveredKcal = Math.round(WAKE_UP_HOUR * sleepFatFaucetHourly);
  const overnight8hNetDrainKcal = overnight8hGrossSleepKcal - overnight8hFatCoveredKcal;
  const kcalBufferAt8amTomorrow = (safeAlpert - projectedMidnightDeficitKcal) - overnight8hNetDrainKcal;
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
      bmrHourly,
      overnightNetDrainHourly
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

  // Signal 1: Intraday slot scan (strictly requires actual muscleContribution > 0.5)
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
      if (slot.muscleContribution > 0.5) {
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

  // ── Signal 4: Zero-AI 3-Day Nutritionist & Dual-Horizon Hepatic + Amino Runway ────────
  const validRecentDays = (recentDays ?? []).slice(0, 3).map((d) => ({
    ...d,
    deficit: d.deficit ?? Math.max(0, d.scoredCaloriesOut - d.caloriesIn),
    vfScore: d.vfScore ?? d.score,
  }));
  const daysAnalyzed = validRecentDays.length;
  const threeDayAvgInKcal =
    daysAnalyzed > 0
      ? Math.round(validRecentDays.reduce((s, d) => s + d.caloriesIn, 0) / daysAnalyzed)
      : safeCaloriesIn;
  const threeDayAvgOutKcal =
    daysAnalyzed > 0
      ? Math.round(validRecentDays.reduce((s, d) => s + d.scoredCaloriesOut, 0) / daysAnalyzed)
      : projectedFullDayBurnKcal;
  const threeDayAvgDeficitKcal =
    daysAnalyzed > 0
      ? Math.round(validRecentDays.reduce((s, d) => s + d.deficit, 0) / daysAnalyzed)
      : prevDayDeficitKcal > 0
        ? Math.round(prevDayDeficitKcal)
        : Math.max(0, projectedMidnightDeficitKcal);

  const scoredDays = validRecentDays.filter((d) => d.vfScore != null);
  const threeDayAvgScore =
    scoredDays.length > 0
      ? Math.round(scoredDays.reduce((s, d) => s + (d.vfScore ?? 0), 0) / scoredDays.length)
      : null;

  const weightedRecentDeficit =
    daysAnalyzed >= 3
      ? 0.55 * validRecentDays[0].deficit +
        0.3 * validRecentDays[1].deficit +
        0.15 * validRecentDays[2].deficit
      : daysAnalyzed === 2
        ? 0.65 * validRecentDays[0].deficit + 0.35 * validRecentDays[1].deficit
        : daysAnalyzed === 1
          ? validRecentDays[0].deficit
          : prevDayDeficitKcal > 0
            ? prevDayDeficitKcal
            : Math.max(0, todayOnlyDeficitKcal);

  const cutIntensity: 'deep_cut' | 'steady_cut' | 'recharged' =
    weightedRecentDeficit >= safeAlpert * 0.52
      ? 'deep_cut'
      : weightedRecentDeficit >= 350
        ? 'steady_cut'
        : 'recharged';

  // Usable morning hepatic glycogen at 8:00 AM (above the 40 kcal cortisol/proteolysis floor).
  // Skeletal muscle glycogen lacks glucose-6-phosphatase and cannot fuel the brain or resting BMR.
  const morningUsableLiverKcal = Math.max(
    70,
    Math.min(165, Math.round(145 - 0.055 * Math.max(0, weightedRecentDeficit - 200)))
  );

  // Waking Non-Fat Gap: energy per waking hour that CANNOT come from the fat faucet
  const wakingNonFatGapHourly = Math.max(
    CNS_OBLIGATE_NET_HOURLY_KCAL,
    Math.max(0, hourlyBurnRateKcal - alpertHourly) + CNS_OBLIGATE_NET_HOURLY_KCAL
  );
  const wakingNonFatGapHourlyKcal = Math.round(wakingNonFatGapHourly);

  // Glucogenic protein sparing bonus (~0.45 kcal/g protein shields hepatic gluconeogenesis)
  const glucogenicProteinBonusKcal = Math.round(Math.max(0, proteinG) * 0.45);
  const wakingHoursSince8am = Math.max(
    0,
    Math.min(SLEEP_START_HOUR, clampedStartHour) - WAKE_UP_HOUR
  );
  const sleepHoursSince23 = Math.max(0, clampedStartHour - SLEEP_START_HOUR);

  const rawUsableNonFatBuffer = Math.round(
    morningUsableLiverKcal +
      safeCaloriesIn +
      glucogenicProteinBonusKcal -
      wakingHoursSince8am * wakingNonFatGapHourly -
      sleepHoursSince23 * overnightNetDrainHourly
  );
  // Hepatic glycogen + active 4h gut/amino pool has a physiological storage ceiling (~420 kcal)
  const usableNonFatBufferKcal = Math.min(
    MAX_USABLE_HEPATIC_GUT_BUFFER_KCAL,
    rawUsableNonFatBuffer
  );

  // Project hours until usableNonFatBufferKcal hits 0 (true hepatic/amino catabolic threshold)
  const hoursUntilHepaticDepletion =
    usableNonFatBufferKcal <= 0
      ? 0
      : projectHoursUntilAlpertBreach(
          clampedStartHour,
          usableNonFatBufferKcal,
          wakingNonFatGapHourly,
          overnightNetDrainHourly,
          overnightNetDrainHourly
        );

  // True optimal eat deadline is the EARLIER of hepatic/amino depletion and the 24h Alpert cap
  const rawOptimalEatHours =
    kcalUntilAlpertBreach <= 0 || usableNonFatBufferKcal <= 0
      ? 0
      : Math.min(hoursUntilHepaticDepletion, hoursUntilAlpertBreach);
  const hoursUntilOptimalEat =
    rawOptimalEatHours <= 0 ? 0 : Math.max(0.1, Math.round(rawOptimalEatHours * 10) / 10);
  const optimalEatByTimeLabel =
    hoursUntilOptimalEat <= 0
      ? 'Now'
      : formatMultiDayBreachTime(clampedStartHour + rawOptimalEatHours);

  // Post-meal insulin clearance & Fat Faucet efficiency
  const activeFoods = (foodLogs ?? []).filter(
    (f) => !f.ignored && (f.calories || 0) > 30 && parseFoodHour(f) <= clampedStartHour + 0.1
  );
  let fatFaucetEfficiencyPct = 100;
  let fatPeakTimeLabel = 'Active Now (100%)';
  let fastUntilHour = clampedStartHour;

  if (activeFoods.length > 0) {
    const latestFood = activeFoods.reduce((latest, f) =>
      parseFoodHour(f) >= parseFoodHour(latest) ? f : latest
    );
    const mealHour = parseFoodHour(latestFood);
    const hoursSinceMeal = Math.max(0, clampedStartHour - mealHour);
    const carbKcal = (latestFood.carbsG || 0) * 4;
    // Lean protein (PSMF) clears insulin in ~0.5h; high-carb meals take ~1.8-2.8h
    const insulinClearHours = Math.min(
      3.0,
      0.45 + (carbKcal / 160) * 1.1 + ((latestFood.calories || 0) / 900) * 0.4
    );
    if (hoursSinceMeal < insulinClearHours) {
      fatFaucetEfficiencyPct = Math.max(
        35,
        Math.min(95, Math.round(40 + 55 * (hoursSinceMeal / insulinClearHours)))
      );
      fastUntilHour = mealHour + insulinClearHours;
      fatPeakTimeLabel = formatMultiDayBreachTime(fastUntilHour);
    }
  }

  // How many hours a ~40-45g lean protein (PSMF) pulse (~200 kcal) adds to the non-fat runway
  const psmfPulseGainHours =
    Math.round((220 / Math.max(25, wakingNonFatGapHourly)) * 10) / 10;

  const cutTag =
    cutIntensity === 'deep_cut'
      ? 'Deep 3d Cut'
      : cutIntensity === 'steady_cut'
        ? 'Steady 3d Cut'
        : 'Glycogen Recharged';

  const threeDaySummaryLabel =
    daysAnalyzed > 0
      ? `${daysAnalyzed}d Avg: ${threeDayAvgInKcal.toLocaleString()} in / ${threeDayAvgOutKcal.toLocaleString()} out (-${threeDayAvgDeficitKcal.toLocaleString()} kcal/d${threeDayAvgScore !== null ? ` · ${threeDayAvgScore > 0 ? '+' : ''}${threeDayAvgScore} pts/d` : ''}) · ${cutTag}`
      : `Recent Baseline: -${Math.max(0, threeDayAvgDeficitKcal).toLocaleString()} kcal/d (${cutTag}) · Morning Liver Buffer: ~${morningUsableLiverKcal} kcal`;

  const sweetSpotWindowLabel =
    hoursUntilOptimalEat <= 0
      ? 'Eat Now (Catabolic Line Reached)'
      : fatFaucetEfficiencyPct < 85
        ? `Fast Until ${fatPeakTimeLabel.replace(/^Today /, '')} (Fat Peak) → Eat Next by ${optimalEatByTimeLabel}`
        : `Fat Faucet 100% Open (${fatFaucetHourlyKcal} kcal/hr) → Eat Next by ${optimalEatByTimeLabel} (~${hoursUntilOptimalEat}h)`;

  let recommendation = '';
  if (hoursUntilOptimalEat <= 0) {
    recommendation = `Catabolic buffer tapped out (${cutTag}). Log a 40–45g lean protein pulse (~200 kcal, <5g carbs) now to block cortisol/muscle loss and buy +${psmfPulseGainHours}h of ${fatFaucetHourlyKcal} kcal/hr fat burn.`;
  } else if (clampedStartHour >= 20 && proteinToGoG <= 15 && safeThrough8amTomorrow) {
    recommendation = `Kitchen Closed / Evening Lock-In (${cutTag}): Fat faucet (${fatFaucetPerMinKcal} kcal/min) covers ~80% of overnight sleep. Ride fast until ${optimalEatByTimeLabel}, then anchor tomorrow with a 40g PSMF protein pulse (+${psmfPulseGainHours}h runway).`;
  } else if (fatFaucetEfficiencyPct < 85) {
    recommendation = `Digesting last meal (fat faucet at ${fatFaucetEfficiencyPct}%). Hold off eating until at least ${fatPeakTimeLabel.replace(/^Today /, '')} so insulin clears, then plan your next ${Math.min(45, Math.max(35, proteinToGoG))}g protein meal by ${optimalEatByTimeLabel}.`;
  } else if (hoursUntilOptimalEat <= 2.5) {
    recommendation = `Peak fat oxidation active (${fatFaucetHourlyKcal} kcal/hr), with ~${usableNonFatBufferKcal} kcal hepatic/amino buffer left (~${hoursUntilOptimalEat}h at ${wakingNonFatGapHourlyKcal} kcal/hr non-fat gap). Take a ~40g lean protein pulse (~200 kcal) by ${optimalEatByTimeLabel} to extend pure fat burn by +${psmfPulseGainHours}h.`;
  } else {
    recommendation = `Sweet Spot Active (${cutTag}): Fat faucet is pumping at ${fatFaucetHourlyKcal} kcal/hr (${fatFaucetPerMinKcal}/min) with ${usableNonFatBufferKcal} kcal hepatic/amino shield left. Keep fasting until ${optimalEatByTimeLabel} (~${hoursUntilOptimalEat}h), then refuel with ~40g lean protein (+${psmfPulseGainHours}h runway).`;
  }

  const nutritionistRx: ZeroAiNutritionistRx = {
    daysAnalyzed,
    threeDayAvgInKcal,
    threeDayAvgOutKcal,
    threeDayAvgDeficitKcal,
    threeDayAvgScore,
    cutIntensity,
    morningUsableLiverKcal,
    wakingNonFatGapHourlyKcal,
    usableNonFatBufferKcal,
    fatFaucetEfficiencyPct,
    fatPeakTimeLabel,
    optimalEatByTimeLabel,
    hoursUntilOptimalEat,
    psmfPulseGainHours,
    threeDaySummaryLabel,
    sweetSpotWindowLabel,
    recommendation,
  };

  // Determine overall status & actionable coaching headline focused on Alpert Breach + 8:00 AM Wake-Up
  let status: EatRunwayStatus = 'clear';
  let headline = 'Alpert Runway Clear';
  let subline = '';

  const breachedNow = kcalUntilAlpertBreach <= 0;
  const burningMuscleNow =
    hoursUntilMuscleBurn !== null &&
    hoursUntilMuscleBurn <= 0.25 &&
    (!safeThrough8amTomorrow || hoursUntilAlpertBreach <= 3);
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
    subline = `Glycogen buffer is tapped out and expected Alpert breach is ${expectedBreachTimeLabel} (~${hoursUntilAlpertBreach}h). Eat ≥${Math.max(150, kcalNeededFor8amTomorrow).toLocaleString()} kcal to protect lean mass.`;
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
    subline = `${kcalUntilAlpertBreach.toLocaleString()} kcal buffer left (~${hoursUntilAlpertBreach}h) — fat faucet (${fatFaucetPerMinKcal} kcal/min) covers ~80% of sleep (~${overnightNetDrainHourlyKcal} kcal/hr net drain), waking at 8:00 AM with +${kcalBufferAt8amTomorrow.toLocaleString()} kcal buffer. ${
      kcalLeftFor100Pts >= 0
        ? `${kcalLeftFor100Pts.toLocaleString()} kcal left for a 100-pt day.`
        : `${Math.abs(kcalLeftFor100Pts).toLocaleString()} kcal past 100-pt line.`
    }`;
  } else {
    status = 'clear';
    headline = `Safe Through Midnight · Est. Breach ${expectedBreachTimeLabel} (~${hoursUntilAlpertBreach}h)`;
    subline = `${kcalUntilAlpertBreach.toLocaleString()} kcal buffer clears midnight, but breaches before 8:00 AM wake-up (~${overnightNetDrainHourlyKcal} kcal/hr net sleep drain after ${fatFaucetPerMinKcal} kcal/min fat faucet). Eat ≥${kcalNeededFor8amTomorrow.toLocaleString()} kcal before bed to clear 8:00 AM.`;
  }

  return {
    status,
    headline,
    subline,
    currentDeficitKcal,
    overnightCarryoverKcal,
    projectedMidnightDeficitKcal,
    kcalUntilAlpertBreach,
    fatFaucetPerMinKcal,
    fatFaucetHourlyKcal,
    wakingBurnPerMinKcal,
    hourlyBurnRateKcal,
    overnightBurnRateKcal,
    overnightNetDrainHourlyKcal,
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
    nutritionistRx,
  };
}

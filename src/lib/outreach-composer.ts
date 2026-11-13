/**
 * @fileOverview Zero-AI Outreach Composer (0 LLM tokens).
 *
 * Wraps `computeEatRunway()` (Alpert & Hepatic Timing Engine) and `calculateDailyVFScore()`
 * to generate Morning, Midday, and Night dispatches for Email & Discord.
 * Every dispatch leads with a concrete "Eat by XYZ" clock or "You're good from yesterday /
 * through 8:00 AM tomorrow" reassurance.
 */

import {
  computeEatRunway,
  computeBurnBetweenHours,
  type EatRunway,
  type RecentDaySummary,
} from './alpert-pace';
import { calculateDailyVFScore, computeAlpertNumber, type DailyVFResult } from './vf-scoring';
import {
  estimateBmrKcal,
  ACTIVITY_CREDIT_FRACTION,
  runMetabolicSimulation,
  computeMuscleGlycogenMaxKcal,
} from './metabolic-engine';
import type {
  HealthData,
  UserPreferences,
  OutreachWindow,
} from './health-service';
import type { FoodLogEntry, ExerciseLogEntry } from './food-exercise-types';
import { addIsoDays, diffIsoDays, type OutreachActionType } from './outreach-auth';

export const SILENT_DAYS_TO_MORNING_ONLY = 5;
export const SILENT_DAYS_TO_AUTO_PAUSE = 10;

export interface QuickActionButton {
  action: OutreachActionType;
  label: string;
  style: 'primary' | 'secondary';
}

export interface ComposedOutreachMessage {
  window: OutreachWindow;
  localDate: string;
  statusTone: 'good' | 'soon' | 'urgent';
  subject: string;
  headline: string;
  body: string;
  lastFoodLine: string;
  metricsLine: string;
  eatByLabel: string;
  goodFromYesterday: boolean;
  safeThroughTomorrowMorning: boolean;
  quickActions: QuickActionButton[];
  autoSunsetBanner?: string;
  runway: EatRunway;
  vfPreview: DailyVFResult;
}

export interface ComposeOutreachInput {
  window: OutreachWindow;
  localDate: string;
  hoursElapsed: number;
  health?: HealthData | null;
  prefs?: UserPreferences | null;
  todayFoods?: FoodLogEntry[];
  yesterdayFoods?: FoodLogEntry[];
  todayExercises?: ExerciseLogEntry[];
  autoSunsetNotice?: 'downshifted_to_morning' | null;
}

function cleanClockLabel(label: string): string {
  return label.replace(/^Today\s+/i, '').trim();
}

function format12hClock(hhmm?: string): string | null {
  if (!hhmm || !/^\d{1,2}:\d{2}/.test(hhmm)) return null;
  const [hRaw, mRaw] = hhmm.split(':');
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function buildLastFoodOnRecordLine(
  todayFoods: FoodLogEntry[] = [],
  yesterdayFoods: FoodLogEntry[] = [],
): string {
  const activeToday = todayFoods
    .filter((f) => !f.ignored && f.name)
    .sort((a, b) => (b.consumedAt || '').localeCompare(a.consumedAt || ''));

  if (activeToday.length > 0) {
    const latest = activeToday[0];
    const atLabel = format12hClock(latest.consumedAt);
    const timePart = atLabel ? ` today at ${atLabel}` : ' today';
    return `Last on record: ${latest.name}${timePart} (${Math.round(latest.calories || 0)} kcal, ${Math.round(latest.proteinG || 0)}g protein).`;
  }

  const activeYesterday = yesterdayFoods
    .filter((f) => !f.ignored && f.name)
    .sort((a, b) => (b.consumedAt || '').localeCompare(a.consumedAt || ''));

  if (activeYesterday.length > 0) {
    const latest = activeYesterday[0];
    const atLabel = format12hClock(latest.consumedAt);
    const timePart = atLabel ? ` yesterday at ${atLabel}` : ' yesterday';
    return `Last on record: ${latest.name}${timePart} (${Math.round(latest.calories || 0)} kcal, ${Math.round(latest.proteinG || 0)}g protein) — nothing logged yet today.`;
  }

  return 'Last on record: Nothing logged yet today.';
}

/**
 * Evaluates quiet-user auto-sunset policy to protect email domain reputation and quota.
 */
export function evaluateAutoSunset(params: {
  localDate: string;
  lastInteractionDate?: string;
  currentCadence: '3x' | 'morning_only';
}): { decision: 'active' | 'downshift_to_morning' | 'auto_pause'; silentDays: number } {
  const { localDate, lastInteractionDate, currentCadence } = params;
  if (!lastInteractionDate) {
    return { decision: 'active', silentDays: 0 };
  }
  const silentDays = Math.max(0, diffIsoDays(lastInteractionDate, localDate));
  if (silentDays >= SILENT_DAYS_TO_AUTO_PAUSE) {
    return { decision: 'auto_pause', silentDays };
  }
  if (silentDays >= SILENT_DAYS_TO_MORNING_ONLY && currentCadence === '3x') {
    return { decision: 'downshift_to_morning', silentDays };
  }
  return { decision: 'active', silentDays };
}

/**
 * Computes live intraday burn, Alpert Eat Runway, and VF Score preview without any LLM calls.
 */
export function buildOutreachRunwayContext(input: ComposeOutreachInput): {
  runway: EatRunway;
  vfPreview: DailyVFResult;
  todayCaloriesIn: number;
  todayProteinG: number;
  proteinGoal: number;
  yesterdaySurplusKcal: number;
  hasYesterdayBreakfast: boolean;
} {
  const {
    localDate,
    hoursElapsed,
    health,
    prefs,
    todayFoods = [],
    yesterdayFoods = [],
    todayExercises = [],
  } = input;

  const weightKg = health?.weightKg ?? prefs?.profile?.weightKg ?? 77;
  const heightCm = health?.heightCm ?? prefs?.profile?.heightCm ?? 178;
  const bodyFatPct = health?.bodyFatPct ?? 22;
  const age = prefs?.profile?.age ?? 35;
  const hasCreatine = Boolean(prefs?.profile?.hasCreatine);
  const proteinGoal = prefs?.targets?.proteinGoal ?? 150;

  const bmrKcal = estimateBmrKcal(weightKg, heightCm, age);
  const alpertNumber = computeAlpertNumber(weightKg, bodyFatPct);

  const activeTodayFoods = todayFoods.filter((f) => !f.ignored);
  const activeYesterdayFoods = yesterdayFoods.filter((f) => !f.ignored);
  const activeTodayExercises = todayExercises.filter((e) => !e.ignored);

  const todayCaloriesIn = activeTodayFoods.reduce((s, f) => s + (f.calories || 0), 0);
  const todayProteinG = Math.round(activeTodayFoods.reduce((s, f) => s + (f.proteinG || 0), 0));
  const todayDrinks = activeTodayFoods.reduce((s, f) => s + (f.alcoholDrinks || 0), 0);
  const todaySeedOilMeals = activeTodayFoods.filter((f) => f.hasSeedOils).length;

  // Circadian elapsed BMR + waking burn up to `hoursElapsed`
  const clampedHours = Math.max(0.5, Math.min(24, hoursElapsed));
  const sleepHourly = bmrKcal / 24;
  const wakingBaselineHourly = sleepHourly * 1.28;
  const estimatedElapsedBurn = Math.round(
    computeBurnBetweenHours(0, clampedHours, wakingBaselineHourly, sleepHourly),
  );
  const loggedExerciseBurn = activeTodayExercises.reduce(
    (s, e) => s + (e.adjustedCalories ?? (e.estimatedCaloriesBurned || 0) * ACTIVITY_CREDIT_FRACTION),
    0,
  );

  // Check if a device snapshot exists for localDate
  const todaySnap = health?.fitbitByDate?.[localDate];
  let elapsedScoredOut = Math.round(estimatedElapsedBurn + loggedExerciseBurn);
  if (todaySnap?.caloriesOut && todaySnap.caloriesOut > 0) {
    const elapsedBmr = (bmrKcal * clampedHours) / 24;
    // Guard against full-day projected caloriesOut being reported early in the morning
    const maxPlausibleElapsed = elapsedBmr * 2.6 + 600;
    const rawDevice = Math.min(todaySnap.caloriesOut, maxPlausibleElapsed);
    elapsedScoredOut = Math.round(
      elapsedBmr + Math.max(0, rawDevice - elapsedBmr) * ACTIVITY_CREDIT_FRACTION,
    );
  }

  // Extract recent completed days (up to 3) & yesterday's deficit/surplus
  const yesterdayIso = addIsoDays(localDate, -1);
  const recentHistory = (health?.history ?? [])
    .filter((h) => h.isoDate && h.isoDate < localDate && h.breakdown)
    .sort((a, b) => (b.isoDate || '').localeCompare(a.isoDate || ''))
    .slice(0, 3);

  const recentDays: RecentDaySummary[] = recentHistory.map((h) => ({
    isoDate: h.isoDate,
    caloriesIn: h.breakdown?.caloriesIn ?? 0,
    scoredCaloriesOut: h.breakdown?.scoredCaloriesOut ?? h.breakdown?.caloriesOut ?? bmrKcal,
    deficit: h.breakdown?.deficit,
    proteinG: h.breakdown?.proteinG,
    alcoholDrinks: h.breakdown?.alcoholDrinks,
    vfScore: h.gain,
  }));

  let prevDayDeficitKcal = 0;
  let yesterdaySurplusKcal = 0;

  const yesterdayHistory = recentHistory.find((h) => h.isoDate === yesterdayIso);
  if (yesterdayHistory?.breakdown) {
    const yIn = yesterdayHistory.breakdown.caloriesIn ?? 0;
    const yOut =
      yesterdayHistory.breakdown.scoredCaloriesOut ??
      yesterdayHistory.breakdown.caloriesOut ??
      Math.round(bmrKcal * 1.2);
    const diff = yOut - yIn;
    if (diff > 0) {
      prevDayDeficitKcal = diff;
    } else {
      yesterdaySurplusKcal = Math.abs(diff);
    }
  } else if (activeYesterdayFoods.length > 0) {
    const yIn = activeYesterdayFoods.reduce((s, f) => s + (f.calories || 0), 0);
    const ySnapOut = health?.fitbitByDate?.[yesterdayIso]?.caloriesOut;
    const yOut = ySnapOut && ySnapOut > 0
      ? Math.round(bmrKcal + Math.max(0, ySnapOut - bmrKcal) * ACTIVITY_CREDIT_FRACTION)
      : Math.round(bmrKcal * 1.2);
    const diff = yOut - yIn;
    if (diff > 0) {
      prevDayDeficitKcal = diff;
    } else {
      yesterdaySurplusKcal = Math.abs(diff);
    }
  }

  // Full-day projected burn for simulation & VF preview
  const remainingBurn = computeBurnBetweenHours(clampedHours, 24, wakingBaselineHourly, sleepHourly);
  const fullDayRawCaloriesOut = Math.max(bmrKcal, Math.round(elapsedScoredOut + remainingBurn));

  const sim = runMetabolicSimulation({
    caloriesOut: fullDayRawCaloriesOut,
    exerciseCreditFraction: ACTIVITY_CREDIT_FRACTION,
    alpertNumber,
    foodLogs: activeTodayFoods,
    exerciseLogs: activeTodayExercises,
    fitbitActivities: todaySnap?.activities,
    caloriesIn: todayCaloriesIn,
    hrv: todaySnap?.hrv ?? health?.hrv,
    hasCreatine,
    weightKg,
    bodyFatPct,
    heightCm,
    age,
    muscleGlycogenMaxKcal: computeMuscleGlycogenMaxKcal(weightKg, bodyFatPct, hasCreatine),
  });

  const runway = computeEatRunway({
    caloriesIn: todayCaloriesIn,
    scoredCaloriesOut: elapsedScoredOut,
    alpertNumber,
    hoursElapsed: clampedHours,
    proteinG: todayProteinG,
    proteinGoal,
    bmrKcal,
    prevDayDeficitKcal,
    slots: sim.slots,
    foodLogs: activeTodayFoods,
    recentDays,
  });

  // Back-solve equivalent raw device caloriesOut so calculateDailyVFScore's creditedCaloriesOut matches fullDayRawCaloriesOut
  const equivalentRawDeviceOut = bmrKcal + Math.max(0, fullDayRawCaloriesOut - bmrKcal) / ACTIVITY_CREDIT_FRACTION;
  const vfPreview = calculateDailyVFScore({
    caloriesIn: todayCaloriesIn,
    caloriesOut: Math.round(equivalentRawDeviceOut),
    proteinG: todayProteinG,
    proteinGoal,
    fastingHours: 0,
    alcoholDrinks: todayDrinks,
    sleepHours: todaySnap?.sleepHours ?? health?.sleepHours ?? 7.5,
    seedOilMeals: todaySeedOilMeals,
    weightKg,
    bodyFatPct,
    heightCm,
    age,
    hrv: todaySnap?.hrv ?? health?.hrv,
    hasCreatine,
    foodLogs: activeTodayFoods,
    prevFoodLogs: activeYesterdayFoods,
    exerciseLogs: activeTodayExercises,
    fitbitActivities: todaySnap?.activities,
  });

  const hasYesterdayBreakfast = activeYesterdayFoods.some((f) => f.meal === 'breakfast' && (f.calories || 0) > 0);

  return {
    runway,
    vfPreview,
    todayCaloriesIn,
    todayProteinG,
    proteinGoal,
    yesterdaySurplusKcal,
    hasYesterdayBreakfast,
  };
}

/**
 * Composes a crisp, 3-second scannable Morning / Midday / Night message.
 */
export function composeOutreachDispatch(input: ComposeOutreachInput): ComposedOutreachMessage {
  const {
    runway,
    vfPreview,
    todayCaloriesIn,
    todayProteinG,
    proteinGoal,
    yesterdaySurplusKcal,
    hasYesterdayBreakfast,
  } = buildOutreachRunwayContext(input);

  const rx = runway.nutritionistRx;
  const eatByClean = cleanClockLabel(rx.optimalEatByTimeLabel);
  const breachClean = cleanClockLabel(runway.expectedBreachTimeLabel);

  const autoSunsetBanner =
    input.autoSunsetNotice === 'downshifted_to_morning'
      ? 'Switched to Morning-Only briefings while things are quiet — tap "Resume 3x/Day" below any time.'
      : undefined;

  let statusTone: 'good' | 'soon' | 'urgent' = 'good';
  let subject = '';
  let headline = '';
  let body = '';
  let goodFromYesterday = false;
  let safeThroughTomorrowMorning = runway.safeThrough8amTomorrow;
  let quickActions: QuickActionButton[] = [];

  if (input.window === 'morning') {
    const bufferedFromYesterday =
      yesterdaySurplusKcal >= 100 ||
      (runway.overnightCarryoverKcal <= 120 && rx.hoursUntilOptimalEat >= 3.5) ||
      (rx.cutIntensity === 'recharged' && rx.hoursUntilOptimalEat >= 2.5);

    if (bufferedFromYesterday && eatByClean !== 'Now') {
      goodFromYesterday = true;
      statusTone = 'good';
      headline = `Last night's fuel holds — eat by ${eatByClean}`;
      subject = `Morning Check-In: Fueled until ${eatByClean}`;
      const surplusNote =
        yesterdaySurplusKcal >= 100
          ? `Yesterday left a +${yesterdaySurplusKcal} kcal fuel cushion, so your morning glycogen buffer is topped off.`
          : `Overnight sleep burn was covered cleanly with ${Math.max(0, rx.usableNonFatBufferKcal)} kcal of morning buffer left.`;
      body = `${surplusNote} Fat faucet is open at ${runway.fatFaucetHourlyKcal} kcal/hr — ride the fast and plan ~40–45g protein by ${eatByClean}.`;
    } else if (eatByClean === 'Now' || runway.status === 'eat_now') {
      statusTone = 'urgent';
      headline = `Overnight tank is low — eat ~40g protein now`;
      subject = `Morning Check-In: Have ~40g protein soon`;
      body = `Carrying a -${Math.max(runway.overnightCarryoverKcal, runway.currentDeficitKcal)} kcal fasted deficit into this morning. A ~200 kcal / 40g protein pulse right now blocks muscle loss and buys +${rx.psmfPulseGainHours}h of pure fat burn.`;
    } else {
      statusTone = rx.hoursUntilOptimalEat <= 2.5 ? 'soon' : 'good';
      headline = `Plan ~40g lean protein by ${eatByClean}`;
      subject = `Morning Check-In: First meal by ${eatByClean}`;
      body =
        runway.overnightCarryoverKcal > 0
          ? `Carrying -${runway.overnightCarryoverKcal} kcal from yesterday's deficit with ~${Math.max(0, rx.usableNonFatBufferKcal)} kcal buffer left. Hit ~40g lean protein by ${eatByClean} (+${rx.psmfPulseGainHours}h fat-burn runway).`
          : `Fat faucet is running at ${runway.fatFaucetHourlyKcal} kcal/hr. Anchor your first ~40–45g protein meal by ${eatByClean} to protect lean mass.`;
    }

    quickActions = [
      { action: 'still_fasting', label: 'Fasting til Lunch', style: 'primary' },
      { action: 'protein_40', label: '+40g Protein Shake', style: 'secondary' },
      hasYesterdayBreakfast
        ? { action: 'same_breakfast', label: 'Same Breakfast as Yesterday', style: 'secondary' }
        : { action: 'eggs_breakfast', label: '3 Eggs + Whites (32g P)', style: 'secondary' },
    ];
  } else if (input.window === 'midday') {
    const recentlyFed = rx.fatFaucetEfficiencyPct < 85 && todayCaloriesIn >= 150;
    if (recentlyFed && eatByClean !== 'Now') {
      statusTone = 'good';
      const fatPeakClean = cleanClockLabel(rx.fatPeakTimeLabel);
      headline = `Last meal is still working — eat next by ${eatByClean}`;
      subject = `Midday Check-In: Fueled until ${eatByClean}`;
      body = `Digesting morning fuel (fat faucet reaches full speed around ${fatPeakClean}). Hold off on snacks and aim for ~45g protein by ${eatByClean} (${runway.proteinToGoG}g left today).`;
    } else if (eatByClean === 'Now' || runway.status === 'eat_now') {
      statusTone = 'urgent';
      headline = `Midday window is open — eat ~45g protein now`;
      subject = `Midday Check-In: Time for ~45g protein`;
      body = `Your non-fat buffer is tapped out (${runway.currentDeficitKcal} kcal deficit so far). Log ~45g lean protein now to shield muscle while keeping fat oxidation high.`;
    } else {
      statusTone = rx.hoursUntilOptimalEat <= 2 ? 'soon' : 'good';
      headline =
        todayCaloriesIn === 0
          ? `Fast is holding strong — eat by ${eatByClean}`
          : `Right on pace — eat next by ${eatByClean}`;
      subject = `Midday Check-In: Next meal by ${eatByClean}`;
      body = `Fat faucet is open at ${runway.fatFaucetHourlyKcal} kcal/hr with ~${Math.max(0, rx.usableNonFatBufferKcal)} kcal buffer remaining. Target ~45g protein by ${eatByClean} (${runway.proteinToGoG}g left toward ${proteinGoal}g).`;
    }

    quickActions = [
      { action: 'protein_45_lunch', label: '+45g Lean Lunch (420 kcal)', style: 'primary' },
      { action: 'protein_40', label: '+40g Protein Shake', style: 'secondary' },
      { action: 'still_fasting', label: 'Still Fasting', style: 'secondary' },
    ];
  } else {
    // Night dispatch (~7:00–7:30 PM local, or late-night manual check)
    const scoreStr = `${vfPreview.score >= 0 ? '+' : ''}${vfPreview.score}`;
    const nightDeadline = input.hoursElapsed >= 20.25 ? 'before bed' : 'by 8:30 PM';
    if (runway.safeThrough8amTomorrow && runway.proteinToGoG <= 25) {
      statusTone = 'good';
      headline = `Fueled through 8:00 AM tomorrow — close the kitchen`;
      subject = `Evening Check-In: Kitchen closed (VF ${scoreStr})`;
      body = `Sleep fat oxidation (${runway.fatFaucetPerMinKcal} kcal/min) covers ~80% of overnight BMR, waking you at 8:00 AM with +${runway.kcalBufferAt8amTomorrow} kcal buffer. Projected VF Score: ${scoreStr} pts.`;
    } else if (!runway.safeThrough8amTomorrow) {
      statusTone = runway.status === 'eat_now' ? 'urgent' : 'soon';
      const neededKcal = Math.max(200, runway.kcalNeededFor8amTomorrow);
      const neededProt = Math.min(50, Math.max(35, runway.proteinToGoG));
      headline = `Add ~${neededProt}g protein (~${neededKcal} kcal) ${nightDeadline}`;
      subject = `Evening Check-In: Have ~${neededProt}g protein ${nightDeadline}`;
      body = `Current buffer breaches overnight (${breachClean}) before 8:00 AM wake-up. One lean ${neededProt}g protein meal ${nightDeadline} locks in overnight recovery (VF Score so far: ${scoreStr}).`;
    } else {
      // Calorie buffer clears 8 AM, but protein asset target is still notably short
      statusTone = 'soon';
      const pulseProt = Math.min(45, runway.proteinToGoG);
      headline = `Calories are set — add ~${pulseProt}g lean protein ${nightDeadline}`;
      subject = `Evening Check-In: ~${pulseProt}g protein ${nightDeadline} (VF ${scoreStr})`;
      body = `Calorie buffer already clears 8:00 AM (+${runway.kcalBufferAt8amTomorrow} kcal), so skip heavy carbs/fats — just add ~${pulseProt}g lean protein ${nightDeadline} to protect muscle (${todayProteinG}/${proteinGoal}g logged).`;
    }

    quickActions = [
      { action: 'kitchen_closed', label: 'Kitchen Closed', style: 'primary' },
      { action: 'dinner_standard', label: '+50g Lean Dinner (580 kcal)', style: 'secondary' },
      { action: 'protein_40', label: '+40g Evening Protein', style: 'secondary' },
    ];
  }

  const lastFoodLine = buildLastFoodOnRecordLine(input.todayFoods, input.yesterdayFoods);
  const scoreBadge = `VF ${vfPreview.score >= 0 ? '+' : ''}${vfPreview.score}`;
  const metricsLine = `${todayCaloriesIn.toLocaleString()} kcal in · ${todayProteinG}/${proteinGoal}g protein · Fat faucet ${runway.fatFaucetHourlyKcal} kcal/hr · ${scoreBadge}`;

  return {
    window: input.window,
    localDate: input.localDate,
    statusTone,
    subject,
    headline,
    body,
    lastFoodLine,
    metricsLine,
    eatByLabel: eatByClean,
    goodFromYesterday,
    safeThroughTomorrowMorning,
    quickActions,
    autoSunsetBanner,
    runway,
    vfPreview,
  };
}

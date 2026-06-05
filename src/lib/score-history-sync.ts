/**
 * @fileOverview Server orchestration for auto-scoring backdated days.
 *
 * Pulls the user's logs + per-day device snapshots for a window, scores every
 * day with activity, and upserts the result into the equity history. Device
 * calorie-burn (Fitbit) is used where present (~last 7 days); older days fall
 * back to a BMR-based estimate, flagged via breakdown.caloriesOutEstimated.
 */

import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService } from './health-service-admin';
import { buildScoreHistory, type DayLogs } from './score-backfill';
import type { FoodLogEntry, ExerciseLogEntry } from './food-exercise-types';

function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

export async function backfillScoreHistory(
  userId: string,
  localDate: string,
  days = 90,
): Promise<{ ok: boolean; scoredDays: number }> {
  const firestore = getAdminFirestore();

  const windowStart = addDays(localDate, -(days - 1));
  const fetchStart = addDays(localDate, -days); // one extra day for the consecutive-alcohol lookback

  const [health, prefs, food, exercise] = await Promise.all([
    adminHealthService.getHealthSummary(firestore, userId),
    adminHealthService.getUserPreferences(firestore, userId),
    adminHealthService.queryLogRangeAll(firestore, userId, 'food_log', fetchStart, localDate),
    adminHealthService.queryLogRangeAll(firestore, userId, 'exercise_log', fetchStart, localDate),
  ]);

  // Group logs by date.
  const logsByDate: Record<string, DayLogs> = {};
  const ensure = (date: string) => (logsByDate[date] ??= { food: [], exercise: [] });
  for (const f of food as unknown as FoodLogEntry[]) if (f.date) ensure(f.date).food.push(f);
  for (const e of exercise as unknown as ExerciseLogEntry[]) if (e.date) ensure(e.date).exercise.push(e);

  // Per-day device calorie-burn.
  const fitbitCaloriesOutByDate: Record<string, number | undefined> = {};
  const fitbitByDate = health?.fitbitByDate ?? {};
  for (const [date, snap] of Object.entries(fitbitByDate)) {
    fitbitCaloriesOutByDate[date] = (snap as { caloriesOut?: number })?.caloriesOut;
  }

  // Build the inclusive window of dates.
  const windowDates: string[] = [];
  for (let d = windowStart; d <= localDate; d = addDays(d, 1)) windowDates.push(d);

  const { history, visceralFatPoints, scoredDays } = buildScoreHistory({
    windowDates,
    logsByDate,
    fitbitCaloriesOutByDate,
    weightKg: health?.weightKg,
    bodyFatPct: health?.bodyFatPct,
    heightCm: health?.heightCm,
    age: prefs?.profile?.age,
    proteinGoal: prefs?.targets?.proteinGoal ?? 150,
    existingHistory: health?.history ?? [],
  });

  // Only write when something actually changed (avoid a needless write every load).
  const prevSig = JSON.stringify((health?.history ?? []).map((h) => [h.isoDate, h.gain, h.equity]));
  const nextSig = JSON.stringify(history.map((h) => [h.isoDate, h.gain, h.equity]));
  if (prevSig !== nextSig) {
    await adminHealthService.updateHealthData(firestore, userId, { history, visceralFatPoints });
  }

  return { ok: true, scoredDays };
}

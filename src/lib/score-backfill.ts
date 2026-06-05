/**
 * @fileOverview Pure helpers for backfilling the daily VF score history.
 *
 * Given a window of days plus the logs / device data for each, compute the VF
 * score for every day that has activity and merge it into the existing history —
 * idempotently (a date already present is replaced, never duplicated) — then
 * rebuild cumulative equity chronologically. No Firestore I/O lives here so it
 * is unit-testable; the orchestration in score-history-sync.ts wires the data.
 */

import { calculateDailyVFScore } from './vf-scoring';
import type { FoodLogEntry, ExerciseLogEntry } from './food-exercise-types';
import type { HistoryEntry, VFBreakdown } from './health-service';

/** Sex-averaged Mifflin–St Jeor resting metabolic rate (kcal/day). */
export function estimateBMR(weightKg = 80, heightCm = 175, age = 40): number {
  return Math.round(10 * weightKg + 6.25 * heightCm - 5 * age - 78);
}

/** Estimate total daily burn for a day with no device data: RMR × light-activity + logged exercise. */
export function estimateCaloriesOut(exerciseCal: number, weightKg?: number, heightCm?: number, age?: number): number {
  return Math.round(estimateBMR(weightKg, heightCm, age) * 1.2) + Math.round(exerciseCal);
}

export interface DayLogs {
  food: FoodLogEntry[];
  exercise: ExerciseLogEntry[];
}

export interface BuildScoreHistoryInput {
  windowDates: string[];                                  // YYYY-MM-DD ascending — the days to (re)score
  logsByDate: Record<string, DayLogs>;                    // must also include the day BEFORE windowDates[0]
  fitbitCaloriesOutByDate: Record<string, number | undefined>;
  weightKg?: number;
  bodyFatPct?: number;
  heightCm?: number;
  age?: number;
  proteinGoal: number;
  existingHistory: HistoryEntry[];
}

export interface BuildScoreHistoryResult {
  history: HistoryEntry[];
  visceralFatPoints: number;
  scoredDays: number;
}

function prevDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

export function buildScoreHistory(input: BuildScoreHistoryInput): BuildScoreHistoryResult {
  // Index existing entries; preserve any without an isoDate under a unique key so
  // they are never merged away.
  const byKey = new Map<string, HistoryEntry>();
  input.existingHistory.forEach((h, i) => byKey.set(h.isoDate || `__noiso_${i}`, h));

  let scoredDays = 0;
  for (const date of input.windowDates) {
    const day = input.logsByDate[date];
    const food = day?.food ?? [];
    const exercise = day?.exercise ?? [];
    if (food.length === 0 && exercise.length === 0) continue; // nothing logged — leave the day unscored
    scoredDays++;

    const caloriesIn = food.reduce((s, e) => s + (e.calories || 0), 0);
    const proteinG = food.reduce((s, e) => s + (e.proteinG || 0), 0);
    const alcoholDrinks = food.reduce((s, e) => s + (e.alcoholDrinks || 0), 0);
    const seedOilMeals = food.filter((e) => e.hasSeedOils === true).length;
    const exerciseCal = exercise.reduce((s, e) => s + (e.adjustedCalories ?? e.estimatedCaloriesBurned ?? 0), 0);

    const deviceOut = input.fitbitCaloriesOutByDate[date];
    const estimated = deviceOut == null;
    const caloriesOut = estimated
      ? estimateCaloriesOut(exerciseCal, input.weightKg, input.heightCm, input.age)
      : deviceOut!;

    const prevFood = input.logsByDate[prevDate(date)]?.food ?? [];
    const alcoholYesterday = prevFood.some((e) => (e.alcoholDrinks || 0) > 0);

    const result = calculateDailyVFScore({
      caloriesIn, caloriesOut, proteinG, proteinGoal: input.proteinGoal,
      fastingHours: 0, alcoholDrinks, sleepHours: 7, seedOilMeals,
      weightKg: input.weightKg, bodyFatPct: input.bodyFatPct,
      foodLogs: food, exerciseLogs: exercise, alcoholYesterday,
    });

    const [y, m, d] = date.split('-').map(Number);
    const displayDate = new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const breakdown: VFBreakdown = {
      caloriesIn, caloriesOut, proteinG, proteinGoal: input.proteinGoal,
      fastingHours: 0, sleepHours: 7, alcoholYesterday, caloriesOutEstimated: estimated,
      ...result.breakdown,
    };

    const existing = byKey.get(date);
    byKey.set(date, {
      ...(existing ?? {}),
      date: displayDate,
      isoDate: date,
      gain: result.score,
      status: result.score >= 0 ? 'Bullish' : 'Correction',
      detail: result.summary,
      equity: 0, // recomputed below
      breakdown,
    });
  }

  // Rebuild chronological history with cumulative equity (running sum of gains).
  const ordered = Array.from(byKey.values()).sort((a, b) => (a.isoDate || '').localeCompare(b.isoDate || ''));
  let running = 0;
  for (const h of ordered) {
    running += h.gain || 0;
    h.equity = running;
  }

  return { history: ordered, visceralFatPoints: running, scoredDays };
}

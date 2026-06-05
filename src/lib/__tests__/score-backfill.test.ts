import { describe, it, expect, vi } from 'vitest';
import { buildScoreHistory, estimateCaloriesOut, type DayLogs } from '../score-backfill';
import type { FoodLogEntry, ExerciseLogEntry } from '../food-exercise-types';
import type { HistoryEntry } from '../health-service';

vi.mock('firebase/firestore', () => ({}));

function food(o: Partial<FoodLogEntry> = {}): FoodLogEntry {
  return {
    name: 'meal', portionG: 300, calories: 600, proteinG: 50, carbsG: 50, fatG: 20, fiberG: 5,
    source: 'user_estimate', meal: 'lunch', consumedAt: '12:00', timestamp: {} as any, date: '2026-06-03', ...o,
  };
}

const baseInput = {
  fitbitCaloriesOutByDate: { '2026-06-03': 3600 } as Record<string, number | undefined>,
  weightKg: 94, bodyFatPct: 22, heightCm: 180, age: 42, proteinGoal: 180,
};

describe('score backfill — buildScoreHistory', () => {
  it('scores days that have logs and skips empty days', () => {
    const logsByDate: Record<string, DayLogs> = {
      '2026-06-02': { food: [food({ date: '2026-06-02', calories: 500 })], exercise: [] },
      '2026-06-03': { food: [food({ date: '2026-06-03', calories: 1500, proteinG: 168 })], exercise: [] },
      // 2026-06-04 intentionally absent (no logs) — must not be scored
    };
    const r = buildScoreHistory({
      ...baseInput,
      windowDates: ['2026-06-02', '2026-06-03', '2026-06-04'],
      logsByDate,
      existingHistory: [],
    });
    expect(r.scoredDays).toBe(2);
    expect(r.history.map((h) => h.isoDate)).toEqual(['2026-06-02', '2026-06-03']);
  });

  it('cumulative equity is the running sum of gains in date order', () => {
    const logsByDate: Record<string, DayLogs> = {
      '2026-06-02': { food: [food({ date: '2026-06-02' })], exercise: [] },
      '2026-06-03': { food: [food({ date: '2026-06-03' })], exercise: [] },
    };
    const r = buildScoreHistory({ ...baseInput, windowDates: ['2026-06-02', '2026-06-03'], logsByDate, existingHistory: [] });
    expect(r.history[0].equity).toBe(r.history[0].gain);
    expect(r.history[1].equity).toBe(r.history[0].gain + r.history[1].gain);
    expect(r.visceralFatPoints).toBe(r.history[1].equity);
  });

  it('is idempotent — re-running replaces, never duplicates, a date', () => {
    const logsByDate: Record<string, DayLogs> = {
      '2026-06-03': { food: [food({ date: '2026-06-03' })], exercise: [] },
    };
    const first = buildScoreHistory({ ...baseInput, windowDates: ['2026-06-03'], logsByDate, existingHistory: [] });
    const second = buildScoreHistory({ ...baseInput, windowDates: ['2026-06-03'], logsByDate, existingHistory: first.history });
    expect(second.history).toHaveLength(1);
    expect(second.history[0].gain).toBe(first.history[0].gain);
    expect(second.visceralFatPoints).toBe(first.visceralFatPoints);
  });

  it('flags BMR-estimated calorie-out when no device data exists for a day', () => {
    const logsByDate: Record<string, DayLogs> = {
      '2026-03-20': { food: [food({ date: '2026-03-20' })], exercise: [] },
    };
    const r = buildScoreHistory({
      ...baseInput,
      fitbitCaloriesOutByDate: {}, // no device data
      windowDates: ['2026-03-20'],
      logsByDate,
      existingHistory: [],
    });
    expect(r.history[0].breakdown?.caloriesOutEstimated).toBe(true);
  });

  it('preserves out-of-window history entries', () => {
    const existing: HistoryEntry[] = [
      { date: 'Jan 1', isoDate: '2026-01-01', gain: 40, status: 'Bullish', detail: 'old', equity: 40 },
    ];
    const logsByDate: Record<string, DayLogs> = {
      '2026-06-03': { food: [food({ date: '2026-06-03' })], exercise: [] },
    };
    const r = buildScoreHistory({ ...baseInput, windowDates: ['2026-06-03'], logsByDate, existingHistory: existing });
    expect(r.history.map((h) => h.isoDate)).toEqual(['2026-01-01', '2026-06-03']);
    // Equity recomputed cumulatively across the full, preserved history.
    expect(r.history[0].equity).toBe(40);
    expect(r.history[1].equity).toBe(40 + r.history[1].gain);
  });

  it('estimateCaloriesOut adds logged exercise on top of an activity-scaled RMR', () => {
    const rest = estimateCaloriesOut(0, 94, 180, 42);
    const withExercise = estimateCaloriesOut(500, 94, 180, 42);
    expect(withExercise).toBe(rest + 500);
    expect(rest).toBeGreaterThan(1500);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { mergeDailySnapshot, snapshotHasData } from '../health-snapshot';

vi.mock('firebase/firestore', () => ({}));

const stored = { steps: 9000, sleepHours: 7.2, caloriesOut: 2600, capturedOnDate: '2026-08-25' };

describe('mergeDailySnapshot', () => {
  it('keeps stored values when the provider reports nothing usable', () => {
    const merged = mergeDailySnapshot(
      stored,
      { steps: 0, sleepHours: 0, capturedOnDate: '2026-08-26' },
      { steps: true, sleep: true, caloriesOut: true },
    );
    expect(merged).toBeNull();
  });

  it('keeps stored values when an unmarked sync still returns zeroes', () => {
    const merged = mergeDailySnapshot(stored, { steps: 0, sleepHours: 0, capturedOnDate: '2026-08-26' });
    expect(merged).toBeNull();
  });

  it('never lets steps regress within a day', () => {
    const merged = mergeDailySnapshot(stored, { steps: 4000, sleepHours: 7.2, capturedOnDate: '2026-08-26' });
    expect(merged).toBeNull();
  });

  it('takes higher steps and marks the capture date', () => {
    const merged = mergeDailySnapshot(stored, { steps: 12000, capturedOnDate: '2026-08-26' });
    expect(merged).toMatchObject({ steps: 12000, sleepHours: 7.2, caloriesOut: 2600, capturedOnDate: '2026-08-26' });
  });

  it('fills a metric that is newly available without touching the others', () => {
    const merged = mergeDailySnapshot(
      { steps: 9000, capturedOnDate: '2026-08-25' },
      { steps: 0, sleepHours: 6.5, recoveryStatus: 'medium', capturedOnDate: '2026-08-26' },
      { steps: true },
    );
    expect(merged).toMatchObject({ steps: 9000, sleepHours: 6.5, recoveryStatus: 'medium' });
  });

  it('writes a first snapshot when nothing is stored yet', () => {
    const merged = mergeDailySnapshot(undefined, { steps: 5000, sleepHours: 8, capturedOnDate: '2026-08-26' });
    expect(merged).toMatchObject({ steps: 5000, sleepHours: 8 });
  });

  it('keeps stored activities when the provider returns none', () => {
    const withWorkout = { ...stored, activities: [{ activityName: 'Run', startTime: '07:00', durationMin: 30, calories: 300, activityTier: 'tier2_steady_state' as const }] };
    const merged = mergeDailySnapshot(withWorkout, { steps: 11000, capturedOnDate: '2026-08-26' });
    expect(merged?.activities).toHaveLength(1);
  });
});

describe('snapshotHasData', () => {
  it('rejects empty and all-zero snapshots', () => {
    expect(snapshotHasData(undefined)).toBe(false);
    expect(snapshotHasData({ steps: 0, sleepHours: 0, capturedOnDate: '2026-08-26' })).toBe(false);
  });

  it('accepts a snapshot with any real measurement', () => {
    expect(snapshotHasData({ steps: 1 })).toBe(true);
    expect(snapshotHasData({ sleepHours: 6 })).toBe(true);
  });
});

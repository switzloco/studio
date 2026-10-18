import { describe, it, expect } from 'vitest';
import {
  computeLevelProgress,
  DEFAULT_LEVEL_HISTORY,
  getEffectiveDayNote,
  type LevelConfig,
} from '../level-tracker';
import { inferScoringRelease } from '../scoring-releases';
import type { HistoryEntry } from '../health-service';

describe('computeLevelProgress', () => {
  it('computes total points, pace, points to target, and Fin Date from history', () => {
    const level: LevelConfig = {
      id: 'test-level',
      name: 'Level 3 - Lock-In',
      startDate: '2026-10-15',
      targetPoints: 500,
      targetDate: '2026-10-28',
      status: 'active',
    };
    const history: HistoryEntry[] = [
      { date: 'Oct 15', isoDate: '2026-10-15', gain: 68, status: 'Bullish', detail: 'ok', equity: 100 },
      { date: 'Oct 16', isoDate: '2026-10-16', gain: -54, status: 'Correction', detail: 'ok', equity: 46 },
      { date: 'Oct 17', isoDate: '2026-10-17', gain: 51, status: 'Bullish', detail: 'ok', equity: 97 },
    ];

    const prog = computeLevelProgress(level, history, {
      todayGain: 85,
      todayIso: '2026-10-18',
    });

    // 68 - 54 + 51 + 85 = 150 over 4 days => 37.5 pts/day
    expect(prog.totalPoints).toBe(150);
    expect(prog.daysScored).toBe(4);
    expect(prog.pointsPerDay).toBe(37.5);
    expect(prog.pointsToTarget).toBe(350);
    // 350 / 37.5 = 9.3 days -> ceil(9.3) = 10 days after 2026-10-18 -> 2026-10-28
    expect(prog.daysToTarget).toBe(9.3);
    expect(prog.projectedFinishDate).toBe('2026-10-28');
    // 10 days left to targetDate (2026-10-28 - 2026-10-18 = 10), 350 / 10 = 35 pts/day
    expect(prog.requiredPointsPerDay).toBe(35);
  });

  it('uses snapshotTotalPoints for archived Google Sheet levels when history is absent', () => {
    const level2 = DEFAULT_LEVEL_HISTORY.find((l) => l.name === 'Level 2')!;
    const prog = computeLevelProgress(level2, [], { todayIso: '2026-10-18' });
    expect(prog.totalPoints).toBe(3277);
    expect(prog.pointsToTarget).toBe(-277);
    expect(prog.pointsPerDay).toBe(41);
    expect(prog.isTargetMet).toBe(true);
  });
});

describe('getEffectiveDayNote & inferScoringRelease', () => {
  it('returns Google Sheet day notes when custom dayNote is not set, and prefers custom dayNote when set', () => {
    expect(getEffectiveDayNote({ isoDate: '2026-03-04' })).toBe('36 Hour Fast with frisbee!');
    expect(getEffectiveDayNote({ isoDate: '2026-03-04', dayNote: 'Custom override' })).toBe('Custom override');
  });

  it('infers scoring engine vintage from breakdown fields and cutover dates', () => {
    expect(inferScoringRelease({ isoDate: '2026-02-14' }).version).toBe('1.0');
    expect(inferScoringRelease({ isoDate: '2026-04-15' }).version).toBe('2.0');
    expect(inferScoringRelease({ isoDate: '2026-08-29' }).version).toBe('3.1');
    expect(
      inferScoringRelease({
        isoDate: '2026-10-18',
        breakdown: {
          fatBalanceKcal: 800,
          scoredCaloriesOut: 2300,
        },
      }).version
    ).toBe('3.2');
  });
});

import { describe, it, expect } from 'vitest';
import { defaultCharacterSheet, CharacterSheet } from '../types';
import { applyDailyProgress, getCatchupDates } from '../engine';
import { getLevelDef } from '../roadmap';

function apply(sheet: CharacterSheet, isoDate: string, rawScore: number, todayIso = isoDate, extra: Partial<{ weightKg: number; bodyFatPct: number }> = {}) {
  return applyDailyProgress({ sheet, isoDate, rawScore, todayIso, ...extra });
}

describe('applyDailyProgress — basic accrual', () => {
  it('accumulates lifetime and current-level points from raw scores', () => {
    let sheet = defaultCharacterSheet('2026-01-01');
    ({ sheet } = apply(sheet, '2026-01-01', 50));
    ({ sheet } = apply(sheet, '2026-01-02', 30));
    expect(sheet.lifetime_points).toBe(80);
    expect(sheet.current_level_points).toBe(80);
  });

  it('is idempotent: re-scoring the same date replaces rather than adds', () => {
    let sheet = defaultCharacterSheet('2026-01-01');
    ({ sheet } = apply(sheet, '2026-01-01', 50));
    ({ sheet } = apply(sheet, '2026-01-01', 80)); // midday chat rescored the same day higher
    expect(sheet.lifetime_points).toBe(80);
    expect(Object.keys(sheet.point_ledger)).toHaveLength(1);
  });
});

describe('applyDailyProgress — level-up gating', () => {
  it('does not level up on points alone if min_days has not elapsed', () => {
    let sheet = defaultCharacterSheet('2026-01-01');
    // Level 1 needs 1000 pts AND 14 days.
    ({ sheet } = apply(sheet, '2026-01-01', 1000, '2026-01-01'));
    expect(sheet.current_level).toBe(1);
  });

  it('levels up once both the point threshold and min_days are satisfied', () => {
    let sheet = defaultCharacterSheet('2026-01-01');
    ({ sheet } = apply(sheet, '2026-01-01', 1000, '2026-01-15')); // 14 days later, todayIso anchors day-count
    expect(sheet.current_level).toBe(2);
    expect(sheet.days_in_current_level).toBe(0);
    expect(sheet.chronicle.some((c) => c.kind === 'level_up')).toBe(true);
  });

  it('grants the level_up_grant item on advancing', () => {
    let sheet = defaultCharacterSheet('2026-01-01');
    ({ sheet } = apply(sheet, '2026-01-01', 1000, '2026-01-15'));
    const grantId = getLevelDef(1).level_up_grant!;
    expect(sheet.inventory.some((i) => i.item_id === grantId)).toBe(true);
  });
});

describe('applyDailyProgress — relic gates', () => {
  it('blocks level-up at a relic-gated level until the body-comp threshold is met', () => {
    let sheet = defaultCharacterSheet('2026-01-01');
    sheet.current_level = 8; // relic_gate: weight <= 205 lbs
    sheet.level_started_iso = '2026-01-01';
    sheet.active_story_arc = { arc_id: getLevelDef(8).arc_id, title: getLevelDef(8).arc_title, chapter: 1, tension: 'rising' };

    // Points + days satisfied, but weight still above threshold.
    ({ sheet } = apply(sheet, '2026-01-01', 2800, '2026-03-01', { weightKg: 100 })); // ~220 lbs
    expect(sheet.current_level).toBe(8);
    expect(sheet.relics_earned).not.toContain('relic_sub205');
  });

  it('claims the relic and unblocks the level-up once the threshold is met', () => {
    let sheet = defaultCharacterSheet('2026-01-01');
    sheet.current_level = 8;
    sheet.level_started_iso = '2026-01-01';
    sheet.active_story_arc = { arc_id: getLevelDef(8).arc_id, title: getLevelDef(8).arc_title, chapter: 1, tension: 'rising' };

    ({ sheet } = apply(sheet, '2026-03-01', 2800, '2026-03-01', { weightKg: 92 })); // ~202.8 lbs, under 205
    expect(sheet.relics_earned).toContain('relic_sub205');
    expect(sheet.current_level).toBe(9);
  });
});

describe('applyDailyProgress — backfilled logging', () => {
  it('anchors days_in_current_level on the real today, not the backfilled date', () => {
    let sheet = defaultCharacterSheet('2026-01-01');
    // Today is Jan 20, but the user is backfilling a day from Jan 5.
    ({ sheet } = apply(sheet, '2026-01-05', 40, '2026-01-20'));
    expect(sheet.days_in_current_level).toBe(19);
    expect(sheet.latest_processed_iso).toBe('2026-01-20');
  });

  it('does not move latest_processed_iso backward when backfilling an older date after a later one', () => {
    let sheet = defaultCharacterSheet('2026-01-01');
    ({ sheet } = apply(sheet, '2026-01-10', 40, '2026-01-10'));
    ({ sheet } = apply(sheet, '2026-01-03', 20, '2026-01-10')); // catch-up entry for an earlier date
    expect(sheet.latest_processed_iso).toBe('2026-01-10');
    expect(sheet.lifetime_points).toBe(60);
  });

  it('exposes catch-up dates logged since the last brief', () => {
    let sheet = defaultCharacterSheet('2026-01-01');
    ({ sheet } = apply(sheet, '2026-01-01', 40, '2026-01-05'));
    sheet.last_brief_iso = '2026-01-01';
    ({ sheet } = apply(sheet, '2026-01-03', 20, '2026-01-05'));
    ({ sheet } = apply(sheet, '2026-01-04', 15, '2026-01-05'));
    const catchup = getCatchupDates(sheet, '2026-01-05');
    expect(catchup).toEqual(['2026-01-03', '2026-01-04']);
  });
});

describe('applyDailyProgress — items', () => {
  it('floors a bad day using an active point_buffer consumable', () => {
    let sheet = defaultCharacterSheet('2026-01-01');
    sheet.inventory.push({ item_id: 'item_potion_of_rest', tier: 1, quantity: 1, acquired_iso: '2026-01-01' });
    sheet.active_effects.push({ item_id: 'item_potion_of_rest', activated_iso: '2026-01-01' });

    ({ sheet } = apply(sheet, '2026-01-02', -40, '2026-01-02'));
    expect(sheet.point_ledger['2026-01-02'].adjustedScore).toBe(-15); // Potion of Rest magnitude
    expect(sheet.inventory.find((i) => i.item_id === 'item_potion_of_rest')).toBeUndefined(); // consumed
  });

  it('leaves a good day untouched by a point_buffer item and does not consume it', () => {
    let sheet = defaultCharacterSheet('2026-01-01');
    sheet.inventory.push({ item_id: 'item_potion_of_rest', tier: 1, quantity: 1, acquired_iso: '2026-01-01' });
    sheet.active_effects.push({ item_id: 'item_potion_of_rest', activated_iso: '2026-01-01' });

    ({ sheet } = apply(sheet, '2026-01-02', 30, '2026-01-02'));
    expect(sheet.point_ledger['2026-01-02'].adjustedScore).toBe(30);
    expect(sheet.inventory.find((i) => i.item_id === 'item_potion_of_rest')).toBeDefined(); // untouched, not consumed
  });
});

describe('applyDailyProgress — Legend endgame', () => {
  it('ascends to Legend status on clearing level 20', () => {
    let sheet = defaultCharacterSheet('2026-01-01');
    sheet.current_level = 20;
    sheet.level_started_iso = '2026-01-01';
    sheet.active_story_arc = { arc_id: getLevelDef(20).arc_id, title: getLevelDef(20).arc_title, chapter: 1, tension: 'rising' };

    ({ sheet } = apply(sheet, '2026-01-01', 4000, '2026-03-01'));
    expect(sheet.status).toBe('Legend');
    expect(sheet.legend).toBeDefined();
    expect(sheet.legend!.realm_stability).toBe(100);
  });

  it('erodes realm_stability under a run of negative days, and recovers under positive ones', () => {
    let sheet = defaultCharacterSheet('2026-01-01');
    sheet.status = 'Legend';
    sheet.level_started_iso = '2026-01-01';
    sheet.legend = { reign_day: 0, realm_stability: 100, reign_events: [] };

    let dates = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05'];
    for (const d of dates) {
      ({ sheet } = apply(sheet, d, -30, d));
    }
    const erodedStability = sheet.legend!.realm_stability;
    expect(erodedStability).toBeLessThan(100);

    let moreDates = ['2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-10'];
    for (const d of moreDates) {
      ({ sheet } = apply(sheet, d, 60, d));
    }
    expect(sheet.legend!.realm_stability).toBeGreaterThan(erodedStability);
  });
});

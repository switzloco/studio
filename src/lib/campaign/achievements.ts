/**
 * @fileOverview Arbitrary, funny, benevolent achievements — the "DCC-lite"
 * flavor on top of the structured epic. Purely deterministic and app-decided;
 * the LLM only narrates the title/summary already produced here.
 */

import type { CharacterSheet } from './types';

export interface AchievementDef {
  id: string;
  title: string;
  summary: string;
}

export interface AchievementContext {
  isoDate: string;
  rawScore: number;
  yesterdayIso: string;
  itemUsedThisCall: boolean;
  relicJustClaimedThisCall: boolean;
  justAscendedToLegend: boolean;
  lifetimePointsBefore: number;
  lifetimePointsAfter: number;
}

const LIFETIME_MILESTONES = [1000, 5000, 10000, 25000, 50000];

export function checkAchievements(sheet: CharacterSheet, ctx: AchievementContext): AchievementDef[] {
  const earned: AchievementDef[] = [];
  const has = (id: string) => sheet.achievements_earned.includes(id);
  const grant = (def: AchievementDef) => {
    if (!has(def.id)) earned.push(def);
  };

  if (Object.keys(sheet.point_ledger).length === 1 && !has('ach_first_blood')) {
    grant({ id: 'ach_first_blood', title: 'First Blood (Well, First Log)', summary: 'The very first day was logged. The chronicle begins.' });
  }

  if (ctx.rawScore >= 100) {
    grant({ id: 'ach_century_day', title: 'Triple Digit Day', summary: `A single day's score cleared 100 (${Math.round(ctx.rawScore)} pts).` });
  }

  const yesterday = sheet.point_ledger[ctx.yesterdayIso];
  if (yesterday && yesterday.adjustedScore < 0 && ctx.rawScore > 0) {
    grant({ id: 'ach_comeback', title: 'The Comeback Kid', summary: 'A negative day was immediately followed by a positive one.' });
  }

  if (hasConsecutiveDays(sheet, ctx.isoDate, 7)) {
    grant({ id: 'ach_iron_week', title: 'Iron Week', summary: 'Seven consecutive days logged without a gap.' });
  }

  if (ctx.itemUsedThisCall) {
    grant({ id: 'ach_first_item', title: 'Pack Rat Graduate', summary: 'An item was invoked for the first time.' });
  }

  if (ctx.relicJustClaimedThisCall) {
    grant({ id: 'ach_relic_hunter', title: 'Relic Hunter', summary: 'A Legendary Relic was claimed.' });
  }

  if (ctx.justAscendedToLegend) {
    grant({ id: 'ach_ascension', title: 'Ascended (No Big Deal)', summary: 'Level 20 cleared. The realm is secured.' });
  }

  for (const milestone of LIFETIME_MILESTONES) {
    if (ctx.lifetimePointsBefore < milestone && ctx.lifetimePointsAfter >= milestone) {
      grant({
        id: `ach_lifetime_${milestone}`,
        title: milestone >= 10000 ? `Lifetime ${milestone.toLocaleString()}: Deeply Suspicious Consistency` : `Lifetime ${milestone.toLocaleString()} Club`,
        summary: `Lifetime points crossed ${milestone.toLocaleString()}.`,
      });
    }
  }

  return earned;
}

function hasConsecutiveDays(sheet: CharacterSheet, endIso: string, count: number): boolean {
  const [y, m, d] = endIso.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  for (let i = 0; i < count; i++) {
    const dt = new Date(base - i * 86400000);
    const iso = dt.toISOString().split('T')[0];
    if (!sheet.point_ledger[iso]) return false;
  }
  return true;
}

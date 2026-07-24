/**
 * @fileOverview Campaign Engine — pure, deterministic. Mirrors the shape of
 * src/lib/vf-scoring.ts: given the day's already-computed VF score, this
 * module is the ONLY place that decides points, level-ups, relics, items,
 * achievements, and the Legend maintenance loop. The LLM never touches any
 * of this — it narrates buildBriefContext()'s output.
 *
 * Same-day recompute & backfill: score_daily_vf is idempotent per isoDate
 * (a midday chat can rescore today; a late log can backfill last Tuesday).
 * point_ledger stores one entry per isoDate and applyDailyProgress always
 * replaces-by-delta, so calling it twice for the same date — or for a date
 * days in the past — never double-counts lifetime_points.
 *
 * Bounded state: point_ledger is pruned on every call to only the current
 * level's window (or a trailing 30-day window once in Legend mode), so the
 * document never grows unbounded across a multi-year campaign. One
 * consequence: re-scoring a date older than that window is treated as a
 * fresh addition rather than a delta — an accepted edge case for logging
 * that far after the fact.
 */

import {
  CharacterSheet,
  ChronicleEntry,
  CampaignStatus,
  CHRONICLE_CAP,
  LEGEND_TRAILING_WINDOW_DAYS,
  REIGN_EVENTS_CAP,
  defaultCharacterSheet,
} from './types';
import { getLevelDef, MAX_LEVEL, LevelDef } from './roadmap';
import { resolveItemEffect, grantItem, getItemDef } from './items';
import { checkAchievements, AchievementContext, AchievementDef } from './achievements';

export type CampaignEvent =
  | { kind: 'level_up'; fromLevel: number; toLevel: number; grant?: string }
  | { kind: 'relic'; relic_id: string; title: string }
  | { kind: 'achievement'; achievement_id: string; title: string; summary: string }
  | { kind: 'legend_ascend' }
  | { kind: 'item_effect'; item_id: string; summary: string };

export interface ApplyDailyProgressInput {
  sheet: CharacterSheet;
  /** The date being scored — "today", or a backfilled past date. */
  isoDate: string;
  /** That day's (already item-agnostic) VF score delta. */
  rawScore: number;
  /** The real current date — anchors days_in_current_level regardless of which date is being scored. */
  todayIso: string;
  weightKg?: number;
  bodyFatPct?: number;
}

export interface ApplyDailyProgressResult {
  sheet: CharacterSheet;
  events: CampaignEvent[];
}

// ── Date helpers (UTC, "YYYY-MM-DD" strings only) ────────────────────────────

function parseIsoMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function dayDiff(fromIso: string, toIso: string): number {
  return Math.round((parseIsoMs(toIso) - parseIsoMs(fromIso)) / 86400000);
}

function subtractDays(iso: string, days: number): string {
  return new Date(parseIsoMs(iso) - days * 86400000).toISOString().split('T')[0];
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ── Sheet mutation helpers ───────────────────────────────────────────────────

function pushChronicle(sheet: CharacterSheet, entry: ChronicleEntry) {
  sheet.chronicle.push(entry);
  if (sheet.chronicle.length > CHRONICLE_CAP) {
    sheet.chronicle = sheet.chronicle.slice(sheet.chronicle.length - CHRONICLE_CAP);
  }
}

function pruneLedger(sheet: CharacterSheet, todayIso: string) {
  const floor = sheet.status === 'Legend' ? subtractDays(todayIso, LEGEND_TRAILING_WINDOW_DAYS) : sheet.level_started_iso;
  for (const key of Object.keys(sheet.point_ledger)) {
    if (key < floor) delete sheet.point_ledger[key];
  }
}

function sumLedgerFrom(sheet: CharacterSheet, floorIso: string): number {
  return Object.entries(sheet.point_ledger)
    .filter(([iso]) => iso >= floorIso)
    .reduce((sum, [, e]) => sum + Math.max(0, e.adjustedScore), 0);
}

// ── Legend maintenance ───────────────────────────────────────────────────────

interface ReignEventDef {
  id: string;
  summary: string;
}

const REIGN_EVENTS: Record<'thriving' | 'steady' | 'slipping', ReignEventDef[]> = {
  thriving: [
    { id: 'reign_festival', summary: 'A festival is held in the realm’s honor — the reign is thriving.' },
    { id: 'reign_envoys', summary: 'Envoys arrive from distant lands, eager to align with a stable realm.' },
  ],
  steady: [
    { id: 'reign_patrol', summary: 'A quiet day on patrol — the realm holds steady.' },
    { id: 'reign_harvest', summary: 'The harvest comes in on schedule. The realm endures.' },
  ],
  slipping: [
    { id: 'reign_unrest', summary: 'Murmurs of unrest reach the throne — the realm needs tending.' },
    { id: 'reign_skirmish', summary: 'A border skirmish flares up, a warning the realm is slipping.' },
  ],
};

function stabilityBand(stability: number): 'thriving' | 'steady' | 'slipping' {
  return stability >= 70 ? 'thriving' : stability >= 40 ? 'steady' : 'slipping';
}

function computeRealmStability(sheet: CharacterSheet, current: number): number {
  const windowStart = subtractDays(sheet.latest_processed_iso, 13);
  const entries = Object.entries(sheet.point_ledger).filter(
    ([iso]) => iso >= windowStart && iso <= sheet.latest_processed_iso,
  );
  if (entries.length === 0) return current;
  const avg = entries.reduce((s, [, e]) => s + e.adjustedScore, 0) / entries.length;
  const target = clamp(50 + avg, 0, 100);
  return Math.round(clamp(current + (target - current) * 0.3, 0, 100));
}

/** Deterministic (no RNG) so the engine stays pure and test-reproducible. */
function pickReignEvent(stability: number): ReignEventDef {
  const pool = REIGN_EVENTS[stabilityBand(stability)];
  return pool[stability % pool.length];
}

export function describeReignEvent(id: string): string | undefined {
  for (const pool of Object.values(REIGN_EVENTS)) {
    const found = pool.find((e) => e.id === id);
    if (found) return found.summary;
  }
  return undefined;
}

// ── Main entry point ─────────────────────────────────────────────────────────

export function applyDailyProgress(input: ApplyDailyProgressInput): ApplyDailyProgressResult {
  const sheet: CharacterSheet = structuredClone(input.sheet);
  const events: CampaignEvent[] = [];
  const { isoDate, rawScore, todayIso, weightKg, bodyFatPct } = input;

  const previousAdjusted = sheet.point_ledger[isoDate]?.adjustedScore ?? 0;
  const lifetimeBefore = sheet.lifetime_points;

  const { adjustedScore, usedItemId, effectSummary } = resolveItemEffect(sheet, isoDate, rawScore);
  const xpGain = Math.max(0, adjustedScore);
  const prevXpGain = Math.max(0, previousAdjusted);
  sheet.lifetime_points += xpGain - prevXpGain;
  sheet.point_ledger[isoDate] = { isoDate, rawScore, adjustedScore, itemEffectApplied: usedItemId };

  if (usedItemId && effectSummary) {
    pushChronicle(sheet, { iso: isoDate, kind: 'item_effect', level: sheet.current_level, summary: effectSummary });
    events.push({ kind: 'item_effect', item_id: usedItemId, summary: effectSummary });
  }

  if (todayIso > sheet.latest_processed_iso) sheet.latest_processed_iso = todayIso;
  sheet.days_in_current_level = Math.max(0, dayDiff(sheet.level_started_iso, sheet.latest_processed_iso));

  let relicJustClaimed = false;

  if (sheet.status === 'Leveling') {
    const levelDef = getLevelDef(sheet.current_level);

    if (levelDef.relic_gate && !sheet.relics_earned.includes(levelDef.relic_gate.relic_id)) {
      const gate = levelDef.relic_gate;
      const value = gate.metric === 'weightLbs' ? (weightKg != null ? weightKg * 2.20462 : undefined) : bodyFatPct;
      if (value != null && value <= gate.threshold) {
        sheet.relics_earned.push(gate.relic_id);
        relicJustClaimed = true;
        pushChronicle(sheet, { iso: isoDate, kind: 'relic', level: sheet.current_level, summary: `Legendary Relic claimed: ${gate.title}.` });
        events.push({ kind: 'relic', relic_id: gate.relic_id, title: gate.title });
      }
    }

    pruneLedger(sheet, todayIso);
    sheet.current_level_points = sumLedgerFrom(sheet, sheet.level_started_iso);

    const ratio = sheet.current_level_points / levelDef.points_to_advance;
    sheet.active_story_arc.tension = ratio >= 0.85 ? 'climax' : 'rising';
    sheet.active_story_arc.chapter = clamp(1 + Math.floor(ratio * 4), 1, 4);

    const relicSatisfied = !levelDef.relic_gate || sheet.relics_earned.includes(levelDef.relic_gate.relic_id);
    const canLevelUp =
      sheet.current_level_points >= levelDef.points_to_advance &&
      sheet.days_in_current_level >= levelDef.min_days &&
      relicSatisfied;

    if (canLevelUp) {
      const fromLevel = sheet.current_level;
      if (fromLevel >= MAX_LEVEL) {
        sheet.status = 'Legend';
        sheet.level_started_iso = sheet.latest_processed_iso; // reign start
        sheet.legend = { reign_day: 0, realm_stability: 100, reign_events: [] };
        sheet.active_story_arc.tension = 'resolved';
        pushChronicle(sheet, { iso: isoDate, kind: 'legend_ascend', level: fromLevel, summary: 'The realm is secured. Legend Status begins.' });
        events.push({ kind: 'legend_ascend' });
      } else {
        const toLevel = fromLevel + 1;
        const nextDef = getLevelDef(toLevel);
        const clearedGrant = levelDef.level_up_grant; // item granted for clearing the level just finished
        sheet.current_level = toLevel;
        sheet.level_started_iso = sheet.latest_processed_iso;
        sheet.days_in_current_level = 0;
        sheet.active_story_arc = { arc_id: nextDef.arc_id, title: nextDef.arc_title, chapter: 1, tension: 'rising' };
        pruneLedger(sheet, todayIso);
        sheet.current_level_points = sumLedgerFrom(sheet, sheet.level_started_iso);
        if (clearedGrant) {
          grantItem(sheet, clearedGrant, isoDate);
          const grantDef = getItemDef(clearedGrant);
          pushChronicle(sheet, { iso: isoDate, kind: 'item_grant', level: toLevel, summary: `Granted: ${grantDef?.name ?? clearedGrant}.` });
        }
        pushChronicle(sheet, { iso: isoDate, kind: 'level_up', level: toLevel, summary: `Level ${fromLevel} cleared. Now Level ${toLevel}: ${nextDef.arc_title}.` });
        events.push({ kind: 'level_up', fromLevel, toLevel, grant: clearedGrant });
      }
    }
  } else {
    pruneLedger(sheet, todayIso);
    const prevStability = sheet.legend?.realm_stability ?? 100;
    const stability = computeRealmStability(sheet, prevStability);
    const reignEvent = pickReignEvent(stability);
    const reignEvents = [...(sheet.legend?.reign_events ?? []), reignEvent.id];
    sheet.legend = {
      reign_day: Math.max(0, dayDiff(sheet.level_started_iso, sheet.latest_processed_iso)),
      realm_stability: stability,
      reign_events: reignEvents.length > REIGN_EVENTS_CAP ? reignEvents.slice(reignEvents.length - REIGN_EVENTS_CAP) : reignEvents,
    };
    pushChronicle(sheet, { iso: isoDate, kind: 'reign_event', level: sheet.current_level, summary: reignEvent.summary });
  }

  const achievementCtx: AchievementContext = {
    isoDate,
    rawScore: adjustedScore,
    yesterdayIso: subtractDays(isoDate, 1),
    itemUsedThisCall: !!usedItemId,
    relicJustClaimedThisCall: relicJustClaimed,
    justAscendedToLegend: events.some((e) => e.kind === 'legend_ascend'),
    lifetimePointsBefore: lifetimeBefore,
    lifetimePointsAfter: sheet.lifetime_points,
  };
  for (const ach of checkAchievements(sheet, achievementCtx) as AchievementDef[]) {
    sheet.achievements_earned.push(ach.id);
    pushChronicle(sheet, { iso: isoDate, kind: 'achievement', level: sheet.current_level, summary: `${ach.title} — ${ach.summary}` });
    events.push({ kind: 'achievement', achievement_id: ach.id, title: ach.title, summary: ach.summary });
  }

  return { sheet, events };
}

// ── Brief context (what gets injected into the Daily Brief prompt) ─────────

export interface BriefContext {
  characterSheetJson: string;
  status: CampaignStatus;
  level?: LevelDef;
  /** Factual chronicle summaries for isoDate (level-ups, relics, item effects, achievements) — narrate these, invent nothing else. */
  todaysEvents: string[];
  lastDayDelta: number;
  catchupDates: string[];
  legendSummary?: { reignDay: number; stability: number; stabilityBand: string; reignEventText: string };
}

/** Dates in the ledger since the last brief that weren't "today" — i.e. silent catch-up days to recap. */
export function getCatchupDates(sheet: CharacterSheet, todayIso: string): string[] {
  const lastBrief = sheet.last_brief_iso;
  if (!lastBrief) return [];
  return Object.keys(sheet.point_ledger)
    .filter((iso) => iso > lastBrief && iso < todayIso)
    .sort();
}

export function markBriefGenerated(sheet: CharacterSheet, todayIso: string): CharacterSheet {
  return { ...sheet, last_brief_iso: todayIso };
}

/**
 * Builds the Daily Brief prompt context by reading the durable chronicle
 * rather than an in-memory events list — this call can happen long after
 * (or well before) the scoring call that produced today's events, since the
 * brief is generated on-demand when the user opens the Campaign tab.
 */
export function buildBriefContext(sheet: CharacterSheet, isoDate: string): BriefContext {
  const todaysEvents = sheet.chronicle
    .filter((c) => c.iso === isoDate && c.kind !== 'catchup')
    .map((c) => c.summary);
  const lastEntry = sheet.point_ledger[isoDate];

  const ctx: BriefContext = {
    characterSheetJson: JSON.stringify(sheet),
    status: sheet.status,
    todaysEvents,
    lastDayDelta: lastEntry?.adjustedScore ?? 0,
    catchupDates: getCatchupDates(sheet, isoDate),
  };

  if (sheet.status === 'Leveling') {
    ctx.level = getLevelDef(sheet.current_level);
  }
  if (sheet.status === 'Legend' && sheet.legend) {
    const band = stabilityBand(sheet.legend.realm_stability);
    const lastEventId = sheet.legend.reign_events[sheet.legend.reign_events.length - 1];
    ctx.legendSummary = {
      reignDay: sheet.legend.reign_day,
      stability: sheet.legend.realm_stability,
      stabilityBand: band,
      reignEventText: (lastEventId && describeReignEvent(lastEventId)) ?? '',
    };
  }
  return ctx;
}

export interface HistoryEntryLike {
  isoDate?: string;
  date?: string;
  gain: number;
}

export interface ReplayHistoryOptions {
  history: HistoryEntryLike[];
  weightKg?: number;
  bodyFatPct?: number;
  realTodayIso?: string;
}

function extractIsoDate(e: HistoryEntryLike): string | undefined {
  if (typeof e.isoDate === 'string' && e.isoDate.trim().length > 0) {
    return e.isoDate.trim();
  }
  if (typeof e.date === 'string') {
    const trimmed = e.date.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
  }
  return undefined;
}

/**
  * Replays a user's entire historical VF scoring record chronologically through
  * the campaign engine. Idempotent and pure.
  */
export function replayHistoryToSheet(opts: ReplayHistoryOptions): { sheet: CharacterSheet; daysReplayed: number } {
  const validEntries: { isoDate: string; gain: number }[] = [];

  for (const e of opts.history) {
    const iso = extractIsoDate(e);
    if (iso) {
      validEntries.push({ isoDate: iso, gain: e.gain });
    }
  }

  validEntries.sort((a, b) => a.isoDate.localeCompare(b.isoDate));

  const realToday = opts.realTodayIso ?? new Date().toISOString().split('T')[0];

  if (validEntries.length === 0) {
    return { sheet: defaultCharacterSheet(realToday), daysReplayed: 0 };
  }

  const earliestIso = validEntries[0].isoDate;
  let sheet = defaultCharacterSheet(earliestIso);

  for (const entry of validEntries) {
    const res = applyDailyProgress({
      sheet,
      isoDate: entry.isoDate,
      rawScore: entry.gain,
      todayIso: entry.isoDate,
      weightKg: opts.weightKg,
      bodyFatPct: opts.bodyFatPct,
    });
    sheet = res.sheet;
  }

  if (realToday > sheet.latest_processed_iso) {
    sheet.latest_processed_iso = realToday;
    sheet.days_in_current_level = Math.max(0, dayDiff(sheet.level_started_iso, realToday));
  }

  return { sheet, daysReplayed: validEntries.length };
}


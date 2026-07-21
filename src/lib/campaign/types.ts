/**
 * @fileOverview Campaign Mode — persistent RPG state ("Character Sheet").
 *
 * The app owns all math, leveling, and item logic. The LLM (campaign-brief
 * flow) only narrates the events this state records — it never computes a
 * number, grants an item, or decides a level-up itself.
 */

export type CampaignStatus = 'Leveling' | 'Legend';

export type ChronicleKind =
  | 'level_up'
  | 'relic'
  | 'item_grant'
  | 'item_effect'
  | 'legend_ascend'
  | 'reign_event'
  | 'achievement'
  | 'catchup';

export interface ChronicleEntry {
  iso: string;
  kind: ChronicleKind;
  level: number;
  summary: string; // app-authored factual summary — NOT LLM prose
}

/** One day's contribution to the campaign. Keyed by isoDate in point_ledger. */
export interface LedgerEntry {
  isoDate: string;
  rawScore: number;
  adjustedScore: number;
  itemEffectApplied?: string; // item_id, if a buff/shield touched this day
}

export interface InventoryItem {
  item_id: string;
  tier: number;
  quantity: number;
  acquired_iso: string;
  charges_remaining?: number;
}

/** A consumable that has been activated but not yet resolved against a day's score. */
export interface ActiveEffect {
  item_id: string;
  activated_iso: string;
  expires_iso?: string; // for multi-day effects (yield_multiplier); one-shot effects omit this
}

export interface StoryArcState {
  arc_id: string;
  title: string;
  chapter: number;
  tension: 'rising' | 'climax' | 'resolved';
}

export interface LegendState {
  reign_day: number;
  realm_stability: number; // 0-100
  reign_events: string[]; // recent reign-event ids, capped
}

export interface CharacterSheet {
  schemaVersion: number;

  // Progression
  current_level: number; // 1-20
  status: CampaignStatus;
  lifetime_points: number;
  current_level_points: number;
  days_in_current_level: number;
  level_started_iso: string; // when the current level (or, in Legend, the reign) began
  latest_processed_iso: string; // max isoDate ever applied — monotonic, drives day-count
  last_brief_iso?: string; // last date a Daily Brief was generated for — drives catch-up recap

  // Narrative state
  active_story_arc: StoryArcState;
  relics_earned: string[];
  achievements_earned: string[];
  chronicle: ChronicleEntry[];

  // Inventory & active effects
  inventory: InventoryItem[];
  active_effects: ActiveEffect[];

  // Bounded per-day ledger: only current level's window (+ trailing 30d in Legend mode)
  point_ledger: Record<string, LedgerEntry>;

  legend?: LegendState;

  updatedAt?: unknown;
}

export const CAMPAIGN_SCHEMA_VERSION = 1;
export const CHRONICLE_CAP = 60;
export const LEGEND_TRAILING_WINDOW_DAYS = 30;
export const REIGN_EVENTS_CAP = 10;

export function defaultCharacterSheet(todayIso: string): CharacterSheet {
  return {
    schemaVersion: CAMPAIGN_SCHEMA_VERSION,
    current_level: 1,
    status: 'Leveling',
    lifetime_points: 0,
    current_level_points: 0,
    days_in_current_level: 0,
    level_started_iso: todayIso,
    latest_processed_iso: todayIso,
    active_story_arc: {
      arc_id: 'l1_waking_watch',
      title: 'The Waking Watch',
      chapter: 1,
      tension: 'rising',
    },
    relics_earned: [],
    achievements_earned: [],
    chronicle: [
      {
        iso: todayIso,
        kind: 'level_up',
        level: 1,
        summary: 'The campaign begins. Level 1: The Waking Watch.',
      },
    ],
    inventory: [],
    active_effects: [],
    point_ledger: {},
  };
}

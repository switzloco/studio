/**
 * @fileOverview The 20-level Campaign roadmap — the authoritative, versioned
 * narrative config. Mirrors the precedent set by src/lib/scoring-releases.ts:
 * a single tunable array is the source of truth for both the engine's math
 * and the prompt's narrative framing.
 *
 * Escalation: Levels 1-5 Local Hero (immediate borders) -> 6-15 Regional
 * Commander (major expeditions) -> 16-20 Realm Sovereign (the whole realm).
 * The two overarching body-comp goals are "Legendary Relics" gating advancement
 * past Levels 8 and 13.
 */

export type CampaignTier = 'Local Hero' | 'Regional Commander' | 'Realm Sovereign';

export interface RelicGate {
  relic_id: string;
  title: string;
  metric: 'weightLbs' | 'bodyFatPct';
  operator: 'lte';
  threshold: number;
}

export interface LevelDef {
  level: number;
  tier: CampaignTier;
  arc_id: string;
  arc_title: string;
  stakes: string;
  points_to_advance: number;
  min_days: number;
  item_tier: number;
  relic_gate?: RelicGate;
  level_up_grant?: string; // item_id, see items.ts
}

const SUB_205_RELIC: RelicGate = {
  relic_id: 'relic_sub205',
  title: 'The Sub-205 Sigil',
  metric: 'weightLbs',
  operator: 'lte',
  threshold: 205,
};

const SUB_26_RELIC: RelicGate = {
  relic_id: 'relic_sub26',
  title: 'The Fatless Crown',
  metric: 'bodyFatPct',
  operator: 'lte',
  threshold: 26,
};

export const LEVELS: LevelDef[] = [
  { level: 1, tier: 'Local Hero', arc_id: 'l1_waking_watch', arc_title: 'The Waking Watch', stakes: 'A lone watcher takes up the first post at the edge of a quiet hearth.', points_to_advance: 1000, min_days: 14, item_tier: 1, level_up_grant: 'item_travelers_ration' },
  { level: 2, tier: 'Local Hero', arc_id: 'l2_border_watch', arc_title: 'The Border Watch', stakes: 'Word spreads of trouble at the border — the watcher must hold the line for two full moons.', points_to_advance: 2000, min_days: 60, item_tier: 1, level_up_grant: 'item_potion_of_rest' },
  { level: 3, tier: 'Local Hero', arc_id: 'l3_village_muster', arc_title: 'The Village Muster', stakes: 'A village rallies behind the hero, and the first real training begins.', points_to_advance: 2000, min_days: 45, item_tier: 1, level_up_grant: 'item_whetstone' },
  { level: 4, tier: 'Local Hero', arc_id: 'l4_the_low_road', arc_title: 'The Low Road', stakes: 'Bandits work the low road between villages; the hero clears it mile by mile.', points_to_advance: 2200, min_days: 45, item_tier: 1, level_up_grant: 'item_reasonable_snack' },
  { level: 5, tier: 'Local Hero', arc_id: 'l5_hearths_secured', arc_title: 'The Hearths Secured', stakes: 'The immediate borders are finally, truly secure. The realm takes notice.', points_to_advance: 2200, min_days: 45, item_tier: 1, level_up_grant: 'item_potion_of_rest' },

  { level: 6, tier: 'Regional Commander', arc_id: 'l6_the_commission', arc_title: 'The Commission', stakes: 'A regional commission is offered — the hero is asked to look beyond one village.', points_to_advance: 2500, min_days: 45, item_tier: 2, level_up_grant: 'item_wardens_ledger' },
  { level: 7, tier: 'Regional Commander', arc_id: 'l7_the_first_march', arc_title: 'The First March', stakes: 'The first true expedition departs, banners raised over unfamiliar ground.', points_to_advance: 2500, min_days: 45, item_tier: 2, level_up_grant: 'item_marching_rations' },
  { level: 8, tier: 'Regional Commander', arc_id: 'l8_the_long_siege', arc_title: 'The Long Siege', stakes: 'A long siege tests discipline above all — legend says the Sub-205 Sigil waits at its end.', points_to_advance: 2800, min_days: 50, item_tier: 2, relic_gate: SUB_205_RELIC, level_up_grant: 'item_wardens_ledger' },
  { level: 9, tier: 'Regional Commander', arc_id: 'l9_the_reckoning', arc_title: 'The Reckoning', stakes: 'With the sigil claimed, old rivals reckon with what the hero has become.', points_to_advance: 2800, min_days: 45, item_tier: 2, level_up_grant: 'item_overachievers_cape' },
  { level: 10, tier: 'Regional Commander', arc_id: 'l10_provinces_bow', arc_title: 'The Provinces Bow', stakes: 'Province after province falls in line behind the growing banner.', points_to_advance: 3000, min_days: 45, item_tier: 2, level_up_grant: 'item_wardens_ledger' },
  { level: 11, tier: 'Regional Commander', arc_id: 'l11_the_grand_muster', arc_title: 'The Grand Muster', stakes: 'A grand muster gathers the region’s strength into one campaign.', points_to_advance: 3000, min_days: 45, item_tier: 3, level_up_grant: 'item_banner_of_momentum' },
  { level: 12, tier: 'Regional Commander', arc_id: 'l12_the_iron_road', arc_title: 'The Iron Road', stakes: 'An iron road is cut through the last resistance in the region.', points_to_advance: 3200, min_days: 45, item_tier: 3, level_up_grant: 'item_banner_of_momentum' },
  { level: 13, tier: 'Regional Commander', arc_id: 'l13_the_fatless_vigil', arc_title: 'The Fatless Vigil', stakes: 'A vigil is kept at the region’s heart — the Fatless Crown is said to be earned here.', points_to_advance: 3200, min_days: 50, item_tier: 3, relic_gate: SUB_26_RELIC, level_up_grant: 'item_crown_fragment' },
  { level: 14, tier: 'Regional Commander', arc_id: 'l14_the_united_banners', arc_title: 'The United Banners', stakes: 'Every banner in the region now marches as one under the crowned hero.', points_to_advance: 3400, min_days: 45, item_tier: 3, level_up_grant: 'item_banner_of_momentum' },
  { level: 15, tier: 'Regional Commander', arc_id: 'l15_the_regions_peace', arc_title: 'The Region’s Peace', stakes: 'The region knows peace for the first time in a generation.', points_to_advance: 3400, min_days: 45, item_tier: 3, level_up_grant: 'item_crown_fragment' },

  { level: 16, tier: 'Realm Sovereign', arc_id: 'l16_the_ascension', arc_title: 'The Ascension', stakes: 'The realm itself calls the hero to the throne — sovereignty is not given lightly.', points_to_advance: 3600, min_days: 45, item_tier: 4, level_up_grant: 'item_crown_fragment' },
  { level: 17, tier: 'Realm Sovereign', arc_id: 'l17_the_far_borders', arc_title: 'The Far Borders', stakes: 'The realm’s far borders must be walked and warded, one by one.', points_to_advance: 3600, min_days: 45, item_tier: 4, level_up_grant: 'item_sovereigns_ward' },
  { level: 18, tier: 'Realm Sovereign', arc_id: 'l18_the_deep_councils', arc_title: 'The Deep Councils', stakes: 'The deep councils of the realm are won over, one hard truth at a time.', points_to_advance: 3800, min_days: 45, item_tier: 4, level_up_grant: 'item_sovereigns_ward' },
  { level: 19, tier: 'Realm Sovereign', arc_id: 'l19_the_last_threshold', arc_title: 'The Last Threshold', stakes: 'One threshold remains between the hero and the crown outright.', points_to_advance: 3800, min_days: 45, item_tier: 4, level_up_grant: 'item_crown_fragment' },
  { level: 20, tier: 'Realm Sovereign', arc_id: 'l20_the_coronation', arc_title: 'The Coronation', stakes: 'The realm is secured. The coronation awaits, and with it, the long reign.', points_to_advance: 4000, min_days: 45, item_tier: 5, level_up_grant: 'item_sovereigns_seal' },
];

export function getLevelDef(level: number): LevelDef {
  const def = LEVELS.find((l) => l.level === level);
  if (!def) throw new Error(`No LevelDef for level ${level}`);
  return def;
}

export const MAX_LEVEL = 20;

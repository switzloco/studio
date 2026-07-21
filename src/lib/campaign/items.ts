/**
 * @fileOverview Decoupled functional items. The LLM never decides what an
 * item does or performs math — it only narrates the execution of the
 * app-calculated effect below. Tier scales with the level band an item is
 * granted in (see roadmap.ts LevelDef.item_tier).
 */

import type { ActiveEffect, CharacterSheet } from './types';

export type ItemEffect =
  | { type: 'point_buffer'; magnitude: number }
  | { type: 'streak_shield'; magnitude: number }
  | { type: 'yield_multiplier'; magnitude: number; days: number }
  | { type: 'relic_passive'; magnitude: number };

export interface ItemDef {
  item_id: string;
  name: string;
  tier: number;
  kind: 'consumable' | 'artifact';
  effect: ItemEffect;
  flavor: string; // narration seed — the LLM may embellish tone, never invent the effect
}

export const ITEM_CATALOG: ItemDef[] = [
  { item_id: 'item_travelers_ration', name: "Traveler's Ration", tier: 1, kind: 'consumable', effect: { type: 'point_buffer', magnitude: 10 }, flavor: 'A ration that is, against all odds, still warm. Floors a rough day at -10.' },
  { item_id: 'item_potion_of_rest', name: 'Potion of Rest', tier: 1, kind: 'consumable', effect: { type: 'point_buffer', magnitude: 15 }, flavor: 'The realm insists you sit down. Floors a recovery day at -15.' },
  { item_id: 'item_reasonable_snack', name: 'Suspiciously Reasonable Snack', tier: 1, kind: 'consumable', effect: { type: 'point_buffer', magnitude: 8 }, flavor: 'It is, somehow, exactly one serving. Floors the day at -8.' },
  { item_id: 'item_whetstone', name: 'Whetstone of Resolve', tier: 1, kind: 'consumable', effect: { type: 'streak_shield', magnitude: 1 }, flavor: 'Sharpens resolve enough to absorb one bad day without breaking the arc.' },

  { item_id: 'item_wardens_ledger', name: "Warden's Ledger", tier: 2, kind: 'consumable', effect: { type: 'streak_shield', magnitude: 1 }, flavor: 'A ledger that forgives exactly one missed entry, and only ever mentions it once.' },
  { item_id: 'item_marching_rations', name: 'Marching Rations', tier: 2, kind: 'consumable', effect: { type: 'point_buffer', magnitude: 20 }, flavor: 'Floors a hard expedition day at -20.' },
  { item_id: 'item_overachievers_cape', name: "Overachiever's Cape", tier: 2, kind: 'consumable', effect: { type: 'yield_multiplier', magnitude: 1.1, days: 2 }, flavor: 'Billows dramatically. +10% on positive days for 2 days.' },

  { item_id: 'item_banner_of_momentum', name: 'Banner of Momentum', tier: 3, kind: 'consumable', effect: { type: 'yield_multiplier', magnitude: 1.15, days: 3 }, flavor: 'Raised over the camp. +15% on positive days for 3 days.' },

  { item_id: 'item_crown_fragment', name: 'Crown Fragment', tier: 4, kind: 'artifact', effect: { type: 'relic_passive', magnitude: 10 }, flavor: 'A shard of the coming crown, worn quietly. A permanent +10 buffer floor.' },
  { item_id: 'item_sovereigns_ward', name: "Sovereign's Ward", tier: 4, kind: 'artifact', effect: { type: 'relic_passive', magnitude: 15 }, flavor: 'A ward that hums faintly on hard days. A permanent +15 buffer floor.' },

  { item_id: 'item_sovereigns_seal', name: "Sovereign's Seal", tier: 5, kind: 'artifact', effect: { type: 'relic_passive', magnitude: 25 }, flavor: 'The seal of a completed reign. Stabilizes the realm on its hardest days.' },
];

export function getItemDef(itemId: string): ItemDef | undefined {
  return ITEM_CATALOG.find((i) => i.item_id === itemId);
}

export interface ItemResolution {
  adjustedScore: number;
  usedItemId?: string;
  effectSummary?: string;
}

/**
 * Applies inventory effects to a day's raw score, in priority order:
 * artifacts (always-on, permanent) first, then the oldest still-valid
 * active_effect (one-shot buffers/shields consumed on use; multi-day
 * multipliers expire by date). Mutates sheet.inventory / active_effects.
 */
export function resolveItemEffect(sheet: CharacterSheet, isoDate: string, rawScore: number): ItemResolution {
  let adjusted = rawScore;
  let usedItemId: string | undefined;
  let effectSummary: string | undefined;

  // Artifacts: permanent, always-on, never consumed.
  for (const inv of sheet.inventory) {
    const def = getItemDef(inv.item_id);
    if (!def || def.kind !== 'artifact' || def.effect.type !== 'relic_passive') continue;
    if (adjusted < -def.effect.magnitude) {
      adjusted = -def.effect.magnitude;
      effectSummary = `${def.name} held the line`;
    }
  }

  // Active (activated-but-unresolved) consumables — expire stale multi-day ones first.
  sheet.active_effects = sheet.active_effects.filter((e) => !e.expires_iso || e.expires_iso >= isoDate);

  const next = sheet.active_effects[0];
  if (next) {
    const def = getItemDef(next.item_id);
    if (def) {
      if (def.effect.type === 'point_buffer' && adjusted < -def.effect.magnitude) {
        adjusted = -def.effect.magnitude;
        usedItemId = def.item_id;
        effectSummary = `${def.name} floored the loss`;
        consumeOneShot(sheet, next);
      } else if (def.effect.type === 'streak_shield') {
        usedItemId = def.item_id;
        effectSummary = `${def.name} shielded the streak`;
        consumeOneShot(sheet, next);
      } else if (def.effect.type === 'yield_multiplier' && adjusted > 0) {
        adjusted = adjusted * def.effect.magnitude;
        usedItemId = def.item_id;
        effectSummary = `${def.name} amplified the gain`;
        // multi-day: not consumed here, expires naturally via expires_iso
      }
    }
  }

  return { adjustedScore: adjusted, usedItemId, effectSummary };
}

function consumeOneShot(sheet: CharacterSheet, effect: ActiveEffect) {
  sheet.active_effects = sheet.active_effects.filter((e) => e !== effect);
  const inv = sheet.inventory.find((i) => i.item_id === effect.item_id);
  if (inv) {
    inv.quantity -= 1;
    if (inv.quantity <= 0) {
      sheet.inventory = sheet.inventory.filter((i) => i !== inv);
    }
  }
}

/** Grants an item to inventory (stacking quantity if already held). Used on level-up. */
export function grantItem(sheet: CharacterSheet, itemId: string, isoDate: string) {
  const def = getItemDef(itemId);
  if (!def) return;
  const existing = sheet.inventory.find((i) => i.item_id === itemId);
  if (existing) {
    existing.quantity += 1;
  } else {
    sheet.inventory.push({ item_id: itemId, tier: def.tier, quantity: 1, acquired_iso: isoDate });
  }
}

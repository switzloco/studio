/**
 * @fileOverview Engaging default text for outgoing meal shares.
 *
 * The native share sheet / clipboard seed text is the first thing a friend
 * sees, so it should create a hook — a reason to actually tap the link —
 * rather than read like a receipt. The sender can always edit it in the
 * share sheet; this is just a better default.
 */

/** A protein-forward "milestone" hook when we know the numbers. */
function milestoneHook(mealName: string, proteinG: number): string {
  return `Just banked ${proteinG}g of protein with ${mealName} 💪 Here's the full breakdown:`;
}

/** A curiosity hook for when we only know the meal name. */
function curiosityHook(mealName: string): string {
  return `Bet you can't guess the macros on ${mealName} 👀 Take a look:`;
}

/** A generic curiosity hook when we don't even have a name. */
const GENERIC_HOOK = "Bet you can't guess the macros on this one 👀 Take a look:";

/**
 * Builds the default share-message text. Prefers a protein milestone when we
 * have the totals, falls back to a curiosity hook keyed on the meal name.
 */
export function shareMealText(opts: { mealName?: string; proteinG?: number }): string {
  const { mealName, proteinG } = opts;
  if (mealName && typeof proteinG === 'number' && proteinG > 0) {
    return milestoneHook(mealName, Math.round(proteinG));
  }
  if (mealName) return curiosityHook(mealName);
  return GENERIC_HOOK;
}

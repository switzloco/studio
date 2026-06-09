'use server';

import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService as healthService } from '@/lib/health-service-admin';
import type { FoodLogEntry, SharedMealItem } from '@/lib/food-exercise-types';

/**
 * Strips a ledger food entry down to an immutable share snapshot — drops the
 * source row's id/timestamp/date/ignored so the share can't drift with edits.
 */
function toShareItem(e: FoodLogEntry): SharedMealItem {
  const { id, timestamp, date, ignored, ...rest } = e;
  return rest;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Deterministic, no-LLM title for v1. Single item → its name; multi → meal + count. */
function buildTitle(items: SharedMealItem[]): string {
  if (items.length === 1) return items[0].name;
  const meal = items[0]?.meal;
  const mealLabel = meal ? titleCase(meal) : 'Meal';
  return `${mealLabel} (${items.length} items)`;
}

export type CreateMealShareResult =
  | { success: true; shareId: string }
  | { success: false; error: string };

/**
 * Creates a public, link-shareable snapshot of one or more of the user's food
 * log entries. Returns the share ID; the caller builds the `/m/{shareId}` URL.
 */
export async function createMealShare(
  userId: string,
  foodLogIds: string[],
  userName?: string,
): Promise<CreateMealShareResult> {
  try {
    if (!userId) return { success: false, error: 'You must be signed in to share.' };
    if (!Array.isArray(foodLogIds) || foodLogIds.length === 0) {
      return { success: false, error: 'No meal selected to share.' };
    }

    const db = getAdminFirestore();
    const entries = await healthService.getFoodEntriesByIds(db, userId, foodLogIds);
    if (entries.length === 0) return { success: false, error: 'Meal not found.' };

    const items = entries.map(toShareItem);
    const shareId = await healthService.createMealShare(db, {
      createdBy: userId,
      createdByName: userName,
      items,
      title: buildTitle(items),
    });

    return { success: true, shareId };
  } catch (error: any) {
    console.error('[ShareMeal] createMealShare error:', error?.message ?? String(error));
    return { success: false, error: error?.message ?? 'Could not create share link.' };
  }
}

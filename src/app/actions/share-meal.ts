'use server';

import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService as healthService } from '@/lib/health-service-admin';
import type { FoodLogEntry, SharedMeal, SharedMealItem } from '@/lib/food-exercise-types';

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

export type LogSharedMealResult =
  | { success: true; logCount: number }
  | { success: false; error: string };

/**
 * Copies the shared meal snapshot into the recipient's own food_log, recalculates
 * their daily totals, and increments the share's logCount for social proof.
 * Works for both authenticated users and anonymous users (who just signed in).
 */
export async function logSharedMeal(
  userId: string,
  shareId: string,
  localDate: string,
): Promise<LogSharedMealResult> {
  try {
    if (!userId) return { success: false, error: 'You must be signed in to log.' };

    const db = getAdminFirestore();
    const share = await healthService.getSharedMeal(db, shareId);
    if (!share) return { success: false, error: 'Shared meal not found.' };
    if (share.revoked) return { success: false, error: 'This share link has been revoked.' };

    const expiresAt = share.expiresAt as { toMillis?: () => number } | null | undefined;
    if (expiresAt?.toMillis && expiresAt.toMillis() < Date.now()) {
      return { success: false, error: 'This share link has expired.' };
    }

    // Log each snapshot item as a new food_log entry under the recipient's account.
    for (const item of share.items) {
      await healthService.logFood(db, userId, { ...item, date: localDate });
    }

    // Recalculate daily totals — exact same pattern as the log_food Genkit tool.
    const allTodayFood = await healthService.queryFoodLog(db, userId, localDate, 100);
    await healthService.updateHealthData(db, userId, {
      dailyProteinG: allTodayFood.reduce((s, e) => s + (e.proteinG || 0), 0),
      dailyCarbsG: allTodayFood.reduce((s, e) => s + (e.carbsG || 0), 0),
      dailyCaloriesIn: allTodayFood.reduce((s, e) => s + (e.calories || 0), 0),
      dailyPlantG: allTodayFood.reduce((s, e) => s + (e.plantMassG || 0), 0),
      lastActiveDate: localDate,
    });

    // Increment social-proof counter — best effort, never fails the request.
    const newLogCount = (share.logCount ?? 0) + 1;
    await db
      .doc(`shared_meals/${shareId}`)
      .update({ logCount: newLogCount })
      .catch(() => { /* non-fatal */ });

    return { success: true, logCount: newLogCount };
  } catch (error: any) {
    console.error('[ShareMeal] logSharedMeal error:', error?.message ?? String(error));
    return { success: false, error: error?.message ?? 'Could not log meal.' };
  }
}

export type GetMySharesResult =
  | { success: true; shares: Pick<SharedMeal, 'id' | 'title' | 'totals' | 'logCount' | 'viewCount' | 'revoked' | 'createdAt'>[] }
  | { success: false; error: string };

export async function getMyShares(userId: string): Promise<GetMySharesResult> {
  try {
    if (!userId) return { success: false, error: 'Not signed in.' };
    const db = getAdminFirestore();
    const shares = await healthService.getSharesByUser(db, userId);
    return {
      success: true,
      shares: shares.map(s => ({
        id: s.id,
        title: s.title,
        totals: s.totals,
        logCount: s.logCount,
        viewCount: s.viewCount,
        revoked: s.revoked,
        createdAt: s.createdAt,
      })),
    };
  } catch (error: any) {
    return { success: false, error: error?.message ?? 'Could not load shares.' };
  }
}

export type RevokeShareResult = { success: boolean; error?: string };

export async function revokeShare(userId: string, shareId: string): Promise<RevokeShareResult> {
  try {
    if (!userId) return { success: false, error: 'Not signed in.' };
    const db = getAdminFirestore();
    const ok = await healthService.revokeShare(db, shareId, userId);
    if (!ok) return { success: false, error: 'Share not found or not yours.' };
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message ?? 'Could not revoke share.' };
  }
}

import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService } from '@/lib/health-service-admin';
import { withingsService } from '@/lib/withings-service';

/** How often (ms) background sync should run — 6 hours. */
export const WITHINGS_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type WithingsSyncResult =
  | { success: true }
  | { success: false; reason: 'no_credentials' | 'token_refresh_failed' | 'api_failed' | 'write_failed' };

/**
 * Syncs today's Withings data for a verified user.
 */
export async function syncWithingsData(userId: string, localDate?: string): Promise<WithingsSyncResult> {
  const firestore = getAdminFirestore();

  const creds = await adminHealthService.getWithingsCredentials(firestore, userId);
  if (!creds) return { success: false, reason: 'no_credentials' };

  let accessToken = creds.accessToken;
  let latestCreds = creds;
  const fiveMinutes = 5 * 60 * 1000;
  
  if (Date.now() + fiveMinutes >= creds.expiresAt) {
    let refreshed;
    try {
      refreshed = await withingsService.refreshAccessToken(creds.refreshToken);
    } catch (error) {
      console.error('[syncWithingsData] Token refresh threw an unexpected error:', error);
      return { success: false, reason: 'token_refresh_failed' };
    }
    if (!refreshed) {
      console.error('[syncWithingsData] Token refresh returned null.');
      return { success: false, reason: 'token_refresh_failed' };
    }
    latestCreds = { ...refreshed, withingsUserId: creds.withingsUserId, lastSyncedAt: creds.lastSyncedAt };
    await adminHealthService.saveWithingsCredentials(firestore, userId, latestCreds);
    accessToken = refreshed.accessToken;
  }

  let result;
  try {
    result = await withingsService.syncTodayData(accessToken, localDate);
  } catch (error) {
    console.error('[syncWithingsData] Withings API call failed:', error);
    return { success: false, reason: 'api_failed' };
  }
  if (!result.success) return { success: false, reason: 'api_failed' };

  const today = localDate || new Date().toISOString().split('T')[0];
  const healthUpdate: Record<string, unknown> = {
    steps: result.steps?.value ?? 0,
    lastActiveDate: today,
  };

  if (result.caloriesOut && result.caloriesOut.value > 0) {
    healthUpdate.dailyCaloriesOut = Math.round(result.caloriesOut.value);
  }

  // Also try to get latest weight
  const latestWeight = await withingsService.getLatestWeight(accessToken);
  if (latestWeight) {
    healthUpdate.weightKg = latestWeight;
  }

  const dailySnapshot: import('./health-service').FitbitDailySnapshot = {
    steps: result.steps?.value ?? 0,
  };
  
  if (healthUpdate.dailyCaloriesOut) {
    dailySnapshot.caloriesOut = healthUpdate.dailyCaloriesOut as number;
  }

  try {
    await adminHealthService.updateHealthData(firestore, userId, healthUpdate);
    await adminHealthService.saveFitbitDailySnapshot(firestore, userId, today, dailySnapshot);
    await adminHealthService.saveWithingsCredentials(firestore, userId, {
      ...latestCreds,
      lastSyncedAt: Date.now(),
    });
  } catch (error) {
    console.error('[syncWithingsData] Firestore write failed after sync:', error);
    return { success: false, reason: 'write_failed' };
  }

  return { success: true };
}

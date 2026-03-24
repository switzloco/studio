import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService } from '@/lib/health-service-admin';
import { ouraService } from '@/lib/oura-service';

/** How often (ms) background sync should run — 6 hours (matches Fitbit). */
export const OURA_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type OuraSyncResult =
  | { success: true }
  | { success: false; reason: 'no_credentials' | 'token_refresh_failed' | 'api_failed' | 'write_failed' };

/**
 * Syncs today's Oura data for a verified user.
 * Refreshes the access token if needed, fetches steps/sleep/HRV,
 * and writes the updated metrics back to Firestore.
 *
 * Uses Admin SDK — has no client auth context.
 */
export async function syncOuraData(userId: string, localDate?: string): Promise<OuraSyncResult> {
  const firestore = getAdminFirestore();

  const creds = await adminHealthService.getOuraCredentials(firestore, userId);
  if (!creds) return { success: false, reason: 'no_credentials' };

  let accessToken = creds.accessToken;
  let latestCreds = creds;
  const fiveMinutes = 5 * 60 * 1000;
  if (Date.now() + fiveMinutes >= creds.expiresAt) {
    let refreshed;
    try {
      refreshed = await ouraService.refreshAccessToken(creds.refreshToken);
    } catch (error) {
      console.error('[syncOuraData] Token refresh threw an unexpected error:', error);
      return { success: false, reason: 'token_refresh_failed' };
    }
    if (!refreshed) {
      console.error('[syncOuraData] Token refresh returned null — token may be revoked. Reconnect Oura.');
      return { success: false, reason: 'token_refresh_failed' };
    }
    latestCreds = { ...refreshed, ouraUserId: creds.ouraUserId, lastSyncedAt: creds.lastSyncedAt };
    await adminHealthService.saveOuraCredentials(firestore, userId, latestCreds);
    accessToken = refreshed.accessToken;
  }

  let result;
  try {
    result = await ouraService.syncTodayData(accessToken, localDate);
  } catch (error) {
    console.error('[syncOuraData] Oura API call failed:', error);
    return { success: false, reason: 'api_failed' };
  }
  if (!result.success) return { success: false, reason: 'api_failed' };

  const today = localDate || new Date().toISOString().split('T')[0];
  const healthUpdate: Record<string, unknown> = {
    steps: result.steps.value,
    sleepHours: result.sleep.value,
    lastActiveDate: today,
  };

  if (result.caloriesOut && result.caloriesOut.value > 0) {
    healthUpdate.dailyCaloriesOut = result.caloriesOut.value;
  }

  const hrv = result.hrv.value;
  if (hrv > 0) {
    healthUpdate.hrv = hrv;
    if (hrv >= 50) healthUpdate.recoveryStatus = 'high';
    else if (hrv >= 30) healthUpdate.recoveryStatus = 'medium';
    else healthUpdate.recoveryStatus = 'low';
  }

  const dailySnapshot: import('./health-service').FitbitDailySnapshot = {
    steps: result.steps.value,
    sleepHours: result.sleep.value,
  };
  if (hrv > 0) {
    dailySnapshot.hrv = hrv;
    dailySnapshot.recoveryStatus = healthUpdate.recoveryStatus as 'low' | 'medium' | 'high';
  }
  if (healthUpdate.dailyCaloriesOut) {
    dailySnapshot.caloriesOut = healthUpdate.dailyCaloriesOut as number;
  }

  try {
    await adminHealthService.updateHealthData(firestore, userId, healthUpdate);
    await adminHealthService.saveFitbitDailySnapshot(firestore, userId, today, dailySnapshot);
    await adminHealthService.saveOuraCredentials(firestore, userId, {
      ...latestCreds,
      lastSyncedAt: Date.now(),
    });
  } catch (error) {
    console.error('[syncOuraData] Firestore write failed after sync:', error);
    return { success: false, reason: 'write_failed' };
  }

  return { success: true };
}

import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService } from '@/lib/health-service-admin';
import { fitbitService } from '@/lib/fitbit-service';

/** How often (ms) background sync should run — 6 hours. */
export const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Syncs today's Fitbit data for a verified user.
 * Refreshes the access token if needed, fetches steps/sleep/HRV,
 * and writes the updated metrics back to Firestore.
 *
 * Uses Admin SDK — has no client auth context.
 */
export type SyncResult =
  | { success: true }
  | { success: false; reason: 'no_credentials' | 'token_refresh_failed' | 'api_failed' | 'write_failed' };

export async function syncFitbitData(userId: string, localDate?: string): Promise<SyncResult> {
  const firestore = getAdminFirestore();

  const creds = await adminHealthService.getFitbitCredentials(firestore, userId);
  if (!creds) return { success: false, reason: 'no_credentials' };

  // Refresh token if within 5 minutes of expiry.
  let accessToken = creds.accessToken;
  // Track the latest credentials so the final lastSyncedAt stamp doesn't need a re-fetch.
  let latestCreds = creds;
  const fiveMinutes = 5 * 60 * 1000;
  if (Date.now() + fiveMinutes >= creds.expiresAt) {
    let refreshed;
    try {
      refreshed = await fitbitService.refreshAccessToken(creds.refreshToken);
    } catch (error) {
      console.error('[syncFitbitData] Token refresh threw an unexpected error:', error);
      return { success: false, reason: 'token_refresh_failed' };
    }
    if (!refreshed) {
      console.error('[syncFitbitData] Token refresh returned null — token may be revoked. Reconnect Fitbit.');
      return { success: false, reason: 'token_refresh_failed' };
    }
    latestCreds = { ...refreshed, fitbitUserId: creds.fitbitUserId, lastSyncedAt: creds.lastSyncedAt };
    await adminHealthService.saveFitbitCredentials(firestore, userId, latestCreds);
    accessToken = refreshed.accessToken;
  }

  let result;
  try {
    result = await fitbitService.syncTodayData(accessToken, localDate);
  } catch (error) {
    console.error('[syncFitbitData] Fitbit API call failed:', error);
    return { success: false, reason: 'api_failed' };
  }
  if (!result.success) return { success: false, reason: 'api_failed' };

  // Build update, deriving recoveryStatus from HRV (same logic as the OAuth callback).
  // Always set lastActiveDate so the dashboard's isNewDay check doesn't reset Fitbit-sourced metrics.
  const today = localDate || new Date().toISOString().split('T')[0];
  const healthUpdate: Record<string, unknown> = {
    steps: result.steps.value,
    sleepHours: result.sleep.value,
    lastActiveDate: today,
  };

  if (result.caloriesOut && result.caloriesOut.value > 0) {
    // Fitbit TDEE estimates run ~10% high — apply a conservative accuracy adjustment.
    healthUpdate.dailyCaloriesOut = Math.round(result.caloriesOut.value * 0.90);
  }

  // Only update HRV and recoveryStatus when Fitbit returns a valid reading.
  // A value of 0 means the sensor failed or data is unavailable — ignore it
  // so stale-but-valid data isn't overwritten by a bad reading.
  const hrv = result.hrv.value;
  if (hrv > 0) {
    healthUpdate.hrv = hrv;
    if (hrv >= 50) healthUpdate.recoveryStatus = 'high';
    else if (hrv >= 30) healthUpdate.recoveryStatus = 'medium';
    else healthUpdate.recoveryStatus = 'low';
  }

  // Build the daily snapshot for historical lookups (steps/HRV visible on past days).
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
  if (result.activities && result.activities.length > 0) {
    dailySnapshot.activities = result.activities;
  }

  try {
    await adminHealthService.updateHealthData(firestore, userId, healthUpdate);
    await adminHealthService.saveFitbitDailySnapshot(firestore, userId, today, dailySnapshot);
    // Stamp lastSyncedAt — reuse latestCreds (already in memory) to avoid a redundant re-fetch.
    await adminHealthService.saveFitbitCredentials(firestore, userId, {
      ...latestCreds,
      lastSyncedAt: Date.now(),
    });
  } catch (error) {
    console.error('[syncFitbitData] Firestore write failed after sync:', error);
    return { success: false, reason: 'write_failed' };
  }

  return { success: true };
}

/**
 * Syncs Fitbit data for a specific past date — updates ONLY the per-day
 * snapshot, never the main health doc fields (steps/HRV/sleepHours).
 *
 * Used when viewing a past date (e.g., finalising yesterday's score the
 * next morning) so you get the complete day's data without clobbering
 * today's live metrics.
 */
export async function syncFitbitSnapshot(userId: string, date: string): Promise<SyncResult> {
  const firestore = getAdminFirestore();

  const creds = await adminHealthService.getFitbitCredentials(firestore, userId);
  if (!creds) return { success: false, reason: 'no_credentials' };

  let accessToken = creds.accessToken;
  let latestCreds = creds;
  const fiveMinutes = 5 * 60 * 1000;
  if (Date.now() + fiveMinutes >= creds.expiresAt) {
    let refreshed;
    try {
      refreshed = await fitbitService.refreshAccessToken(creds.refreshToken);
    } catch (error) {
      console.error('[syncFitbitSnapshot] Token refresh error:', error);
      return { success: false, reason: 'token_refresh_failed' };
    }
    if (!refreshed) return { success: false, reason: 'token_refresh_failed' };
    latestCreds = { ...refreshed, fitbitUserId: creds.fitbitUserId, lastSyncedAt: creds.lastSyncedAt };
    await adminHealthService.saveFitbitCredentials(firestore, userId, latestCreds);
    accessToken = refreshed.accessToken;
  }

  let result;
  try {
    result = await fitbitService.syncTodayData(accessToken, date);
  } catch (error) {
    console.error('[syncFitbitSnapshot] Fitbit API call failed:', error);
    return { success: false, reason: 'api_failed' };
  }
  if (!result.success) return { success: false, reason: 'api_failed' };

  const hrv = result.hrv.value;
  const snapshot: import('./health-service').FitbitDailySnapshot = {
    steps: result.steps.value,
    sleepHours: result.sleep.value,
  };
  if (hrv > 0) {
    snapshot.hrv = hrv;
    snapshot.recoveryStatus = hrv >= 50 ? 'high' : hrv >= 30 ? 'medium' : 'low';
  }
  if (result.caloriesOut && result.caloriesOut.value > 0) {
    snapshot.caloriesOut = Math.round(result.caloriesOut.value * 0.90);
  }
  if (result.activities && result.activities.length > 0) {
    snapshot.activities = result.activities;
  }

  try {
    await adminHealthService.saveFitbitDailySnapshot(firestore, userId, date, snapshot);
  } catch (error) {
    console.error('[syncFitbitSnapshot] Firestore write failed:', error);
    return { success: false, reason: 'write_failed' };
  }

  return { success: true };
}

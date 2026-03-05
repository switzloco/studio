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
  const healthUpdate: Record<string, unknown> = {
    steps: result.steps.value,
    sleepHours: result.sleep.value,
    hrv: result.hrv.value,
  };

  if (result.caloriesOut && result.caloriesOut.value > 0) {
    healthUpdate.dailyCaloriesOut = result.caloriesOut.value;
  }

  const hrv = result.hrv.value;
  if (hrv >= 50) healthUpdate.recoveryStatus = 'high';
  else if (hrv >= 30) healthUpdate.recoveryStatus = 'medium';
  else if (hrv > 0) healthUpdate.recoveryStatus = 'low';

  try {
    await adminHealthService.updateHealthData(firestore, userId, healthUpdate);
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

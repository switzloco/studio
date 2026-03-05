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
export async function syncFitbitData(userId: string, localDate?: string): Promise<{ success: boolean }> {
  const firestore = getAdminFirestore();

  const creds = await adminHealthService.getFitbitCredentials(firestore, userId);
  if (!creds) return { success: false };

  // Refresh token if within 5 minutes of expiry.
  let accessToken = creds.accessToken;
  const fiveMinutes = 5 * 60 * 1000;
  if (Date.now() + fiveMinutes >= creds.expiresAt) {
    const refreshed = await fitbitService.refreshAccessToken(creds.refreshToken);
    if (!refreshed) return { success: false };
    await adminHealthService.saveFitbitCredentials(firestore, userId, {
      ...refreshed,
      fitbitUserId: creds.fitbitUserId,
      lastSyncedAt: creds.lastSyncedAt,
    });
    accessToken = refreshed.accessToken;
  }

  let result;
  try {
    result = await fitbitService.syncTodayData(accessToken, localDate);
  } catch (error) {
    console.error('[syncFitbitData] Fitbit API call failed:', error);
    return { success: false };
  }
  if (!result.success) return { success: false };

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

  await adminHealthService.updateHealthData(firestore, userId, healthUpdate);

  // Stamp lastSyncedAt so cron and client know when we last pulled.
  const updatedCreds = await adminHealthService.getFitbitCredentials(firestore, userId);
  if (updatedCreds) {
    await adminHealthService.saveFitbitCredentials(firestore, userId, {
      ...updatedCreds,
      lastSyncedAt: Date.now(),
    });
  }

  return { success: true };
}

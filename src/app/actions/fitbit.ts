
'use server';

import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService } from '@/lib/health-service-admin';
import { syncFitbitData as _syncFitbitData, syncFitbitSnapshot as _syncFitbitSnapshot } from '@/lib/fitbit-sync';
import { fitbitService } from '@/lib/fitbit-service';
import type { SyncResult } from '@/lib/fitbit-sync';

export type { SyncResult };

export async function syncFitbitData(userId: string, localDate?: string): Promise<SyncResult> {
  return _syncFitbitData(userId, localDate);
}

/** Syncs a specific past date — snapshot only, never overwrites today's live metrics. */
export async function syncFitbitSnapshot(userId: string, date: string): Promise<SyncResult> {
  return _syncFitbitSnapshot(userId, date);
}

/**
 * Returns the lastSyncedAt timestamp (ms) for a user's Fitbit credentials,
 * or null if not connected.
 */
export async function getFitbitLastSyncedAt(userId: string): Promise<number | null> {
  const firestore = getAdminFirestore();
  const creds = await adminHealthService.getFitbitCredentials(firestore, userId);
  return creds?.lastSyncedAt ?? null;
}

/**
 * Backfills per-day Fitbit snapshots for the last 7 days.
 * Fetches fresh data from the Fitbit API (free tier) and writes a snapshot
 * for each day that has any data — fixes the "shows today's calories for
 * past dates" issue for days before the snapshot system was deployed.
 */
export async function backfillFitbitHistory(userId: string): Promise<{ ok: boolean; days: number }> {
  const firestore = getAdminFirestore();
  let creds = await adminHealthService.getFitbitCredentials(firestore, userId);
  if (!creds) return { ok: false, days: 0 };

  // Refresh token if near expiry.
  const fiveMinutes = 5 * 60 * 1000;
  if (Date.now() + fiveMinutes >= creds.expiresAt) {
    const refreshed = await fitbitService.refreshAccessToken(creds.refreshToken);
    if (!refreshed) return { ok: false, days: 0 };
    creds = { ...refreshed, fitbitUserId: creds.fitbitUserId, lastSyncedAt: creds.lastSyncedAt };
    await adminHealthService.saveFitbitCredentials(firestore, userId, creds);
  }

  try {
    const result = await fitbitService.syncInitialData(creds.accessToken);
    if (!result.dailySnapshots) return { ok: true, days: 0 };

    await Promise.all(
      Object.entries(result.dailySnapshots).map(([date, snap]) =>
        adminHealthService.saveFitbitDailySnapshot(firestore, userId, date, snap)
      )
    );
    return { ok: true, days: Object.keys(result.dailySnapshots).length };
  } catch (err) {
    console.error('[backfillFitbitHistory] Failed:', err);
    return { ok: false, days: 0 };
  }
}

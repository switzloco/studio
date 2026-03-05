
'use server';

import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService } from '@/lib/health-service-admin';
import { syncFitbitData as _syncFitbitData } from '@/lib/fitbit-sync';
import type { SyncResult } from '@/lib/fitbit-sync';

export type { SyncResult };

export async function syncFitbitData(userId: string, localDate?: string): Promise<SyncResult> {
  return _syncFitbitData(userId, localDate);
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


'use server';

import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService } from '@/lib/health-service-admin';
import { syncOuraData as _syncOuraData } from '@/lib/oura-sync';
import type { OuraSyncResult } from '@/lib/oura-sync';

export type { OuraSyncResult };

export async function syncOuraData(userId: string, localDate?: string): Promise<OuraSyncResult> {
  return _syncOuraData(userId, localDate);
}

/**
 * Returns the lastSyncedAt timestamp (ms) for a user's Oura credentials,
 * or null if not connected.
 */
export async function getOuraLastSyncedAt(userId: string): Promise<number | null> {
  const firestore = getAdminFirestore();
  const creds = await adminHealthService.getOuraCredentials(firestore, userId);
  return creds?.lastSyncedAt ?? null;
}

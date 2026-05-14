
'use server';

import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService } from '@/lib/health-service-admin';
import { syncWithingsData as _syncWithingsData } from '@/lib/withings-sync';
import type { WithingsSyncResult } from '@/lib/withings-sync';

export type { WithingsSyncResult };

export async function syncWithingsData(userId: string, localDate?: string): Promise<WithingsSyncResult> {
  return _syncWithingsData(userId, localDate);
}

export async function getWithingsLastSyncedAt(userId: string): Promise<number | null> {
  const firestore = getAdminFirestore();
  const creds = await adminHealthService.getWithingsCredentials(firestore, userId);
  return creds?.lastSyncedAt ?? null;
}

export async function disconnectWithings(userId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const firestore = getAdminFirestore();
    await adminHealthService.deleteWithingsCredentials(firestore, userId);
    await adminHealthService.updateHealthData(firestore, userId, {
      isDeviceVerified: false,
      connectedDevice: null,
    });
    return { ok: true };
  } catch (err: any) {
    console.error('[disconnectWithings] Failed:', err);
    return { ok: false, error: err?.message ?? 'Unknown error' };
  }
}

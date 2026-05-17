
'use server';

import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService } from '@/lib/health-service-admin';
import { syncWithingsData as _syncWithingsData } from '@/lib/withings-sync';
import type { WithingsSyncResult } from '@/lib/withings-sync';

export type { WithingsSyncResult };

const WITHINGS_AUTH_BASE = 'https://account.withings.com';

/**
 * Builds the Withings OAuth authorize URL at request time. Reading the client
 * ID in a server action — not from a NEXT_PUBLIC_* baked into the browser
 * bundle — sidesteps the build-time-inlining hazard that left the deployed
 * client showing "integration is not configured" even when the var was set.
 */
export async function getWithingsAuthUrl(
  userId: string,
  origin: string
): Promise<{ url: string } | { error: string }> {
  const clientId = process.env.NEXT_PUBLIC_WITHINGS_CLIENT_ID;
  if (!clientId) {
    return { error: 'Withings integration is not configured on the server. Contact support.' };
  }
  const redirectUri = `${origin}/api/auth/withings/callback`;
  const scope = 'user.activity,user.metrics';
  const state = encodeURIComponent(JSON.stringify({ uid: userId, redirect: redirectUri }));
  const url = `${WITHINGS_AUTH_BASE}/oauth2_user/authorize2?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${state}`;
  return { url };
}

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


'use server';

import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService } from '@/lib/health-service-admin';
import { syncOuraData as _syncOuraData } from '@/lib/oura-sync';
import type { OuraSyncResult } from '@/lib/oura-sync';

export type { OuraSyncResult };

const OURA_AUTH_BASE = 'https://cloud.ouraring.com';

/**
 * Builds the Oura OAuth authorize URL at request time. See the matching
 * Withings action for the rationale (env-var build-time inlining hazard).
 */
export async function getOuraAuthUrl(
  userId: string,
  origin: string
): Promise<{ url: string } | { mock: true } | { error: string }> {
  const clientId = process.env.NEXT_PUBLIC_OURA_CLIENT_ID;
  if (!clientId) {
    return { mock: true };
  }
  const redirectUri = `${origin}/api/auth/oura/callback`;
  const scope = 'daily sleep personal';
  const state = encodeURIComponent(JSON.stringify({ uid: userId, redirect: redirectUri }));
  const url = `${OURA_AUTH_BASE}/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${state}`;
  return { url };
}

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

/**
 * Removes Oura credentials and marks the device as disconnected.
 * Uses Admin SDK so it works regardless of client-side Firestore rules.
 */
export async function disconnectOura(userId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const firestore = getAdminFirestore();
    await adminHealthService.deleteOuraCredentials(firestore, userId);
    await adminHealthService.updateHealthData(firestore, userId, {
      isDeviceVerified: false,
      connectedDevice: null,
    });
    return { ok: true };
  } catch (err: any) {
    console.error('[disconnectOura] Failed:', err);
    return { ok: false, error: err?.message ?? 'Unknown error' };
  }
}

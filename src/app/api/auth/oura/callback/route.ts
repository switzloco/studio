
import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService } from '@/lib/health-service-admin';
import { ouraService } from '@/lib/oura-service';

/**
 * @fileOverview Oura OAuth2 Callback Handler.
 * Strict device verification policy: isDeviceVerified is ONLY set to true
 * after a successful token exchange with the Oura API.
 *
 * Uses the Admin SDK so Firestore writes bypass security rules — the callback
 * runs server-side with no user auth context.
 */

function getPublicOrigin(request: NextRequest): string {
  const proto = request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? request.nextUrl.host;
  return process.env.NEXT_PUBLIC_APP_URL ?? `${proto}://${host}`;
}

function parseState(raw: string, fallbackOrigin: string): { userId: string; redirectUri: string } {
  try {
    const parsed = JSON.parse(raw);
    if (parsed.uid && parsed.redirect) {
      return { userId: parsed.uid, redirectUri: parsed.redirect };
    }
  } catch { /* not JSON — legacy format */ }
  return { userId: raw, redirectUri: `${fallbackOrigin}/api/auth/oura/callback` };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  const origin = getPublicOrigin(request);
  let appRoot = `${origin}/`;

  if (!code) {
    return NextResponse.redirect(new URL('?error=oura_auth_failed', appRoot));
  }

  if (!state) {
    console.error('[OuraCallback] Missing state parameter — rejecting to prevent anonymous verification');
    return NextResponse.redirect(new URL('?error=oura_missing_state', appRoot));
  }

  const { userId, redirectUri } = parseState(state, origin);

  // Derive the absolute app root from the trusted redirectUri in state.
  // This bypasses unreliable header-based origin detection in Cloud Run/App Hosting.
  try {
    appRoot = new URL('/', redirectUri).toString();
  } catch (e) {
    console.warn('[OuraCallback] Malformed redirectUri in state, falling back to header-based origin:', redirectUri);
  }

  try {
    const firestore = getAdminFirestore();

    const creds = await ouraService.exchangeCodeForTokens(code, redirectUri);

    if (!creds) {
      await adminHealthService.logActivity(firestore, userId, {
        category: 'health_sync',
        content: 'Hardware Audit Failed: Oura token exchange rejected. Device verification NOT granted.',
        metrics: ['status:rejected', 'source:oura'],
        verified: false,
      });
      return NextResponse.redirect(new URL('?error=oura_token_exchange_failed', appRoot));
    }

    await adminHealthService.saveOuraCredentials(firestore, userId, {
      ...creds,
      lastSyncedAt: Date.now(),
    });

    const syncResult = await ouraService.syncInitialData(creds.accessToken);

    const healthUpdate: Record<string, unknown> = {
      isDeviceVerified: true,
      connectedDevice: 'oura',
      onboardingDay: 1,
      steps: syncResult.steps.value,
      sleepHours: syncResult.sleep.value,
      hrv: syncResult.hrv.value,
    };
    if (syncResult.weightKg) healthUpdate.weightKg = syncResult.weightKg;
    if (syncResult.heightCm) healthUpdate.heightCm = syncResult.heightCm;
    if (syncResult.caloriesOut && syncResult.caloriesOut.value > 0) {
      healthUpdate.dailyCaloriesOut = syncResult.caloriesOut.value;
    }

    if (syncResult.hrv.value >= 50) healthUpdate.recoveryStatus = 'high';
    else if (syncResult.hrv.value >= 30) healthUpdate.recoveryStatus = 'medium';
    else if (syncResult.hrv.value > 0) healthUpdate.recoveryStatus = 'low';

    await adminHealthService.updateHealthData(firestore, userId, healthUpdate);

    const snapshotDate = syncResult.dataDate || new Date().toISOString().split('T')[0];
    const snapshot: import('@/lib/health-service').FitbitDailySnapshot = {
      steps: syncResult.steps.value,
      sleepHours: syncResult.sleep.value,
    };
    if (syncResult.hrv.value > 0) {
      snapshot.hrv = syncResult.hrv.value;
      snapshot.recoveryStatus = healthUpdate.recoveryStatus as 'low' | 'medium' | 'high';
    }
    if (healthUpdate.dailyCaloriesOut) {
      snapshot.caloriesOut = healthUpdate.dailyCaloriesOut as number;
    }
    await adminHealthService.saveFitbitDailySnapshot(firestore, userId, snapshotDate, snapshot);

    const datePart = syncResult.dataDate ? ` (data from ${syncResult.dataDate})` : '';
    await adminHealthService.logActivity(firestore, userId, {
      category: 'health_sync',
      content: `Hardware Audit Successful: Oura Ring linked${datePart}. Steps: ${syncResult.steps.value}, Sleep: ${syncResult.sleep.value.toFixed(1)}h, HRV: ${syncResult.hrv.value}ms.${syncResult.weightKg ? ` Weight: ${syncResult.weightKg}kg.` : ''}`,
      metrics: [
        'status:verified',
        'source:oura',
        `steps:${syncResult.steps.value}`,
        `sleep_h:${syncResult.sleep.value.toFixed(1)}`,
        `hrv:${syncResult.hrv.value}`,
        ...(syncResult.weightKg ? [`weight_kg:${syncResult.weightKg}`] : []),
        ...(syncResult.heightCm ? [`height_cm:${syncResult.heightCm}`] : []),
      ],
      verified: true,
    });

    return NextResponse.redirect(new URL('?oura_sync=success', appRoot));
  } catch (error) {
    console.error('[OuraCallback] Unexpected error during handshake:', error);
    return NextResponse.redirect(new URL('?error=oura_sync_error', appRoot));
  }
}

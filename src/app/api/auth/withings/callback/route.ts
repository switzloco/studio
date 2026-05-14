
import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService } from '@/lib/health-service-admin';
import { withingsService } from '@/lib/withings-service';

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
  } catch { /* not JSON */ }
  return { userId: raw, redirectUri: `${fallbackOrigin}/api/auth/withings/callback` };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  const origin = getPublicOrigin(request);
  let appRoot = `${origin}/`;

  if (!code) {
    return NextResponse.redirect(new URL('?error=withings_auth_failed', appRoot));
  }

  if (!state) {
    return NextResponse.redirect(new URL('?error=withings_missing_state', appRoot));
  }

  const { userId, redirectUri } = parseState(state, origin);

  try {
    appRoot = new URL('/', redirectUri).toString();
  } catch (e) {
    console.warn('[WithingsCallback] Malformed redirectUri in state:', redirectUri);
  }

  try {
    const firestore = getAdminFirestore();

    const creds = await withingsService.exchangeCodeForTokens(code, redirectUri);

    if (!creds) {
      return NextResponse.redirect(new URL('?error=withings_token_exchange_failed', appRoot));
    }

    await adminHealthService.saveWithingsCredentials(firestore, userId, {
      ...creds,
      lastSyncedAt: Date.now(),
    });

    const syncResult = await withingsService.syncTodayData(creds.accessToken);

    const healthUpdate: Record<string, unknown> = {
      isDeviceVerified: true,
      connectedDevice: 'withings',
      steps: syncResult.steps?.value ?? 0,
    };
    
    if (syncResult.caloriesOut && syncResult.caloriesOut.value > 0) {
      healthUpdate.dailyCaloriesOut = syncResult.caloriesOut.value;
    }

    const latestWeight = await withingsService.getLatestWeight(creds.accessToken);
    if (latestWeight) healthUpdate.weightKg = latestWeight;

    await adminHealthService.updateHealthData(firestore, userId, healthUpdate);

    const snapshotDate = syncResult.dataDate || new Date().toISOString().split('T')[0];
    const snapshot: import('@/lib/health-service').FitbitDailySnapshot = {
      steps: syncResult.steps?.value ?? 0,
      caloriesOut: healthUpdate.dailyCaloriesOut as number,
    };
    await adminHealthService.saveFitbitDailySnapshot(firestore, userId, snapshotDate, snapshot);

    await adminHealthService.logActivity(firestore, userId, {
      category: 'health_sync',
      content: `Hardware Audit Successful: Withings linked. Steps: ${healthUpdate.steps}${healthUpdate.weightKg ? `, Weight: ${healthUpdate.weightKg}kg` : ''}.`,
      metrics: [
        'status:verified',
        'source:withings',
        `steps:${healthUpdate.steps}`,
        ...(healthUpdate.weightKg ? [`weight_kg:${healthUpdate.weightKg}`] : []),
      ],
      verified: true,
    });

    return NextResponse.redirect(new URL('?withings_sync=success', appRoot));
  } catch (error) {
    console.error('[WithingsCallback] Unexpected error:', error);
    return NextResponse.redirect(new URL('?error=withings_sync_error', appRoot));
  }
}

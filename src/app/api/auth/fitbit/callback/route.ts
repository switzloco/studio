
import { NextRequest, NextResponse } from 'next/server';
import { initializeFirebase } from '@/firebase/sdk';
import { healthService } from '@/lib/health-service';
import { fitbitService } from '@/lib/fitbit-service';

/**
 * @fileOverview Fitbit OAuth2 Callback Handler.
 * Strict device verification policy: isDeviceVerified is ONLY set to true
 * after a successful token exchange with the Fitbit API.
 */

/** Returns the public-facing origin, safe to use in OAuth redirect URIs and browser redirects. */
function getPublicOrigin(request: NextRequest): string {
  // Firebase App Hosting (and most proxies) set x-forwarded-proto / x-forwarded-host.
  const proto = request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '');
  const host  = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? request.nextUrl.host;
  // Env var override for local dev when the dev server binds to 0.0.0.0.
  return process.env.NEXT_PUBLIC_APP_URL ?? `${proto}://${host}`;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state'); // userId passed via state param

  const origin = getPublicOrigin(request);
  const appRoot = `${origin}/`;

  if (!code) {
    return NextResponse.redirect(new URL('?error=fitbit_auth_failed', appRoot));
  }

  if (!state) {
    console.error('[FitbitCallback] Missing state parameter — rejecting to prevent anonymous verification');
    return NextResponse.redirect(new URL('?error=fitbit_missing_state', appRoot));
  }

  const userId = state;
  const redirectUri = `${origin}/api/auth/fitbit/callback`;

  try {
    const { firestore } = initializeFirebase();

    const creds = await fitbitService.exchangeCodeForTokens(code, redirectUri);

    if (!creds) {
      await healthService.logActivity(firestore, userId, {
        category: 'health_sync',
        content: 'Hardware Audit Failed: Fitbit token exchange rejected. Device verification NOT granted.',
        metrics: ['status:rejected', 'source:fitbit'],
        verified: false,
      });
      return NextResponse.redirect(new URL('?error=fitbit_token_exchange_failed', appRoot));
    }

    // Persist credentials so future syncs can refresh the token without re-auth.
    await healthService.saveFitbitCredentials(firestore, userId, creds);

    // Fetch today's actual device data immediately.
    const syncResult = await fitbitService.syncTodayData(creds.accessToken);

    // Write verified device metrics and flip the trust flag.
    await healthService.updateHealthData(firestore, userId, {
      isDeviceVerified: true,
      onboardingDay: 1,
      steps: syncResult.steps.value,
      sleepHours: syncResult.sleep.value,
      hrv: syncResult.hrv.value,
    });

    await healthService.logActivity(firestore, userId, {
      category: 'health_sync',
      content: `Hardware Audit Successful: Fitbit linked. Steps: ${syncResult.steps.value}, Sleep: ${syncResult.sleep.value.toFixed(1)}h, HRV: ${syncResult.hrv.value}ms.`,
      metrics: [
        'status:verified',
        'source:fitbit',
        `fitbit_user:${creds.fitbitUserId}`,
        `steps:${syncResult.steps.value}`,
        `sleep_h:${syncResult.sleep.value.toFixed(1)}`,
        `hrv:${syncResult.hrv.value}`,
      ],
      verified: true,
    });

    return NextResponse.redirect(new URL('?fitbit_sync=success', appRoot));
  } catch (error) {
    console.error('[FitbitCallback] Unexpected error during handshake:', error);
    return NextResponse.redirect(new URL('?error=fitbit_sync_error', appRoot));
  }
}

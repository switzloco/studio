
import { NextRequest, NextResponse } from 'next/server';
import { initializeFirebase } from '@/firebase/sdk';
import { healthService } from '@/lib/health-service';
import { fitbitService } from '@/lib/fitbit-service';

/**
 * @fileOverview Fitbit OAuth2 Callback Handler.
 * Strict device verification policy: isDeviceVerified is ONLY set to true
 * after a successful token exchange with the Fitbit API.
 */

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state'); // Contains the userId, set during auth URL generation

  // Guard 1: code is required — no code means the user denied access or the flow was tampered with
  if (!code) {
    return NextResponse.redirect(new URL('/?error=fitbit_auth_failed', request.url));
  }

  // Guard 2: state (userId) is required — reject flows with no traceable owner
  if (!state) {
    console.error('[FitbitCallback] Missing state parameter — rejecting to prevent anonymous verification');
    return NextResponse.redirect(new URL('/?error=fitbit_missing_state', request.url));
  }

  const userId = state;
  const redirectUri = `${request.nextUrl.origin}/api/auth/fitbit/callback`;

  try {
    const { firestore } = initializeFirebase();

    // Guard 3: Attempt real token exchange — only proceed on success
    const tokens = await fitbitService.exchangeCodeForTokens(code, redirectUri);

    if (!tokens) {
      // Token exchange failed — log the failure and do NOT set isDeviceVerified
      await healthService.logActivity(firestore, userId, {
        category: 'health_sync',
        content: 'Hardware Audit Failed: Fitbit token exchange rejected. Device verification NOT granted.',
        metrics: ['status:rejected', 'source:fitbit'],
        verified: false,
      });
      return NextResponse.redirect(new URL('/?error=fitbit_token_exchange_failed', request.url));
    }

    // Token exchange succeeded — now safe to mark device as verified
    await healthService.updateHealthData(firestore, userId, {
      isDeviceVerified: true,
      onboardingDay: 1,
    });

    await healthService.logActivity(firestore, userId, {
      category: 'health_sync',
      content: 'Hardware Audit Successful: Fitbit Cloud linked. Device-verified data now trusted.',
      metrics: ['status:verified', 'source:fitbit', `fitbit_user:${tokens.fitbitUserId}`],
      verified: true,
    });

    return NextResponse.redirect(new URL('/?fitbit_sync=success', request.url));
  } catch (error) {
    console.error('[FitbitCallback] Unexpected error during handshake:', error);
    return NextResponse.redirect(new URL('/?error=fitbit_sync_error', request.url));
  }
}

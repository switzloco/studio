
import { NextRequest, NextResponse } from 'next/server';
import { initializeFirebase } from '@/firebase/sdk';
import { healthService } from '@/lib/health-service';
import { fitbitService } from '@/lib/fitbit-service';

/**
 * @fileOverview Fitbit OAuth2 Callback Handler.
 * Manages the transition from user authorization to secure hardware audit.
 */

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state'); // Typically used to pass the userId

  if (!code) {
    return NextResponse.redirect(new URL('/?error=fitbit_auth_failed', request.url));
  }

  try {
    // In a real Day 2 scenario, we exchange 'code' for 'tokens' here.
    // For Day 1, we simulate a successful secure handshake.
    const { firestore } = initializeFirebase();
    
    // Assume state contains userId for this flow
    const userId = state || 'anonymous_auditor'; 
    
    // Simulate successful hardware verification
    await healthService.updateHealthData(firestore, userId, {
      isDeviceVerified: true,
      onboardingDay: 1, // Confirming baseline
    });

    await healthService.logActivity(firestore, userId, {
      category: 'health_sync',
      content: 'Hardware Audit Successful: Fitbit Cloud linked. Vanity metrics ignored.',
      metrics: ['status:verified', 'source:fitbit'],
      verified: true
    });

    // Return to the dashboard with a success flag
    return NextResponse.redirect(new URL('/?fitbit_sync=success', request.url));
  } catch (error) {
    console.error('Fitbit Handshake Error:', error);
    return NextResponse.redirect(new URL('/?error=fitbit_sync_error', request.url));
  }
}

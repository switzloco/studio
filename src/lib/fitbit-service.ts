
/**
 * @fileOverview Fitbit service for the CFO audit.
 * Manages hardware verification and cloud-to-cloud synchronization.
 */

export interface FitbitMetric {
  value: number;
  source: 'device' | 'manual';
}

export interface FitbitSyncResult {
  success: boolean;
  steps: FitbitMetric;
  sleep: FitbitMetric;
  hrv: FitbitMetric;
  isVerified: boolean;
}

export const fitbitService = {
  /**
   * Generates the authorization URL for the client.
   * @param userId The ID of the portfolio to link.
   */
  getAuthUrl(userId: string): string {
    const clientId = process.env.NEXT_PUBLIC_FITBIT_CLIENT_ID || 'MOCK_ID';
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:9002';
    const redirectUri = `${origin}/api/auth/fitbit/callback`;
    const scope = 'activity heartrate sleep profile';
    
    // We pass userId in the 'state' parameter to maintain audit trail during callback
    return `https://www.fitbit.com/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${userId}`;
  },

  /**
   * Exchanges an authorization code for access tokens via the Fitbit API.
   * Falls back to mock mode if credentials are absent (dev/test environments).
   * @param code The authorization code from the OAuth callback.
   * @param redirectUri The redirect URI used during authorization.
   */
  async exchangeCodeForTokens(
    code: string,
    redirectUri: string
  ): Promise<{ accessToken: string; fitbitUserId: string } | null> {
    const clientId = process.env.NEXT_PUBLIC_FITBIT_CLIENT_ID;
    const clientSecret = process.env.FITBIT_CLIENT_SECRET;

    // If credentials are absent, run in dev/mock mode with a clear warning
    if (!clientId || clientSecret === undefined) {
      console.warn('[FitbitService] Missing FITBIT_CLIENT_SECRET — running in mock mode. Set env vars for production.');
      return { accessToken: 'mock_token', fitbitUserId: 'mock_fitbit_user' };
    }

    // Real Fitbit token exchange (PKCE not required for confidential clients)
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const params = new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });

    const response = await fetch('https://api.fitbit.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      console.error('[FitbitService] Token exchange failed:', response.status, await response.text());
      return null;
    }

    const data = await response.json() as { access_token: string; user_id: string };
    return { accessToken: data.access_token, fitbitUserId: data.user_id };
  },

  /**
   * Mock sync returns 'device' source for verification auditing.
   * Day 1: Returns simulated hardware data.
   * Day 2: Will fetch from Fitbit Web API.
   */
  async syncDayOneData(): Promise<FitbitSyncResult> {
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    return {
      success: true,
      steps: { value: 8432, source: 'device' },
      sleep: { value: 7.2, source: 'device' },
      hrv: { value: 62, source: 'device' },
      isVerified: true
    };
  }
};

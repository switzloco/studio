
/**
 * @fileOverview Fitbit service for the CFO audit.
 * Manages hardware verification and cloud-to-cloud synchronization.
 */

import { Firestore } from 'firebase/firestore';
import { healthService, FitbitCredentials } from '@/lib/health-service';

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

interface FitbitTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: string;
}

async function fitbitFetch(endpoint: string, accessToken: string): Promise<unknown | null> {
  const res = await fetch(`https://api.fitbit.com${endpoint}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 204) return null; // no data for today
  if (!res.ok) {
    console.error(`[FitbitService] API error ${res.status} for ${endpoint}`);
    return null;
  }
  return res.json();
}

export const fitbitService = {
  /**
   * Generates the authorization URL for the client.
   */
  getAuthUrl(userId: string): string {
    const clientId = process.env.NEXT_PUBLIC_FITBIT_CLIENT_ID || 'MOCK_ID';
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:9002';
    const redirectUri = `${origin}/api/auth/fitbit/callback`;
    const scope = 'activity heartrate sleep profile';
    return `https://www.fitbit.com/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${userId}`;
  },

  /**
   * Exchanges an authorization code for access + refresh tokens.
   * Falls back to mock credentials if env vars are absent.
   */
  async exchangeCodeForTokens(
    code: string,
    redirectUri: string
  ): Promise<FitbitCredentials | null> {
    const clientId = process.env.NEXT_PUBLIC_FITBIT_CLIENT_ID;
    const clientSecret = process.env.FITBIT_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      console.warn('[FitbitService] Missing credentials — running in mock mode.');
      return {
        accessToken: 'mock_token',
        refreshToken: 'mock_refresh',
        fitbitUserId: 'mock_fitbit_user',
        expiresAt: Date.now() + 8 * 60 * 60 * 1000,
      };
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch('https://api.fitbit.com/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ code, grant_type: 'authorization_code', redirect_uri: redirectUri }).toString(),
    });

    if (!res.ok) {
      console.error('[FitbitService] Token exchange failed:', res.status, await res.text());
      return null;
    }

    const data = await res.json() as FitbitTokenResponse;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      fitbitUserId: data.user_id,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  },

  /**
   * Uses the refresh token to get a new access token before it expires.
   */
  async refreshAccessToken(refreshToken: string): Promise<FitbitCredentials | null> {
    const clientId = process.env.NEXT_PUBLIC_FITBIT_CLIENT_ID;
    const clientSecret = process.env.FITBIT_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      console.warn('[FitbitService] Cannot refresh — no credentials. Still in mock mode.');
      return null;
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch('https://api.fitbit.com/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
    });

    if (!res.ok) {
      console.error('[FitbitService] Token refresh failed:', res.status, await res.text());
      return null;
    }

    const data = await res.json() as FitbitTokenResponse;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      fitbitUserId: data.user_id,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  },

  /**
   * Fetches today's steps, sleep, and HRV from the Fitbit Web API.
   * Returns mock data if the token is the dev mock.
   */
  async syncTodayData(accessToken: string): Promise<FitbitSyncResult> {
    if (accessToken === 'mock_token') {
      return {
        success: true,
        steps: { value: 8432, source: 'device' },
        sleep: { value: 7.2, source: 'device' },
        hrv: { value: 62, source: 'device' },
        isVerified: true,
      };
    }

    const [activitiesData, sleepData, hrvData] = await Promise.all([
      fitbitFetch('/1/user/-/activities/date/today.json', accessToken),
      fitbitFetch('/1.2/user/-/sleep/date/today.json', accessToken),
      fitbitFetch('/1/user/-/hrv/date/today.json', accessToken),
    ]);

    const steps = (activitiesData as any)?.summary?.steps ?? 0;
    const totalMinutesAsleep = (sleepData as any)?.summary?.totalMinutesAsleep ?? 0;
    const dailyRmssd = (hrvData as any)?.hrv?.[0]?.value?.dailyRmssd ?? 0;

    return {
      success: true,
      steps:  { value: steps, source: 'device' },
      sleep:  { value: totalMinutesAsleep / 60, source: 'device' },
      hrv:    { value: Math.round(dailyRmssd), source: 'device' },
      isVerified: true,
    };
  },

  /**
   * Loads stored credentials, refreshes the token if within 5 minutes of
   * expiry, syncs today's data, and persists updated tokens if refreshed.
   */
  async syncWithStoredTokens(db: Firestore, userId: string): Promise<FitbitSyncResult | null> {
    let creds = await healthService.getFitbitCredentials(db, userId);
    if (!creds) return null;

    const fiveMinutes = 5 * 60 * 1000;
    if (Date.now() + fiveMinutes >= creds.expiresAt) {
      const refreshed = await fitbitService.refreshAccessToken(creds.refreshToken);
      if (!refreshed) return null;
      creds = { ...refreshed, fitbitUserId: creds.fitbitUserId };
      await healthService.saveFitbitCredentials(db, userId, creds);
    }

    return fitbitService.syncTodayData(creds.accessToken);
  },
};

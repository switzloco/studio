
/**
 * @fileOverview Withings Health API service for calorie tracking.
 * Manages OAuth2 handshake and data synchronization.
 */

import { Firestore } from 'firebase/firestore';
import { healthService, WithingsCredentials } from '@/lib/health-service';

export interface WithingsMetric {
  value: number;
  source: 'device' | 'manual';
}

export interface WithingsSyncResult {
  success: boolean;
  caloriesOut?: WithingsMetric;
  steps?: WithingsMetric;
  weightKg?: number;
  isVerified: boolean;
  dataDate?: string;
}

interface WithingsTokenResponse {
  status: number;
  body: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    userid: string;
    token_type: string;
    scope: string;
  };
}

const WITHINGS_API_BASE = 'https://wbsapi.withings.net';
const WITHINGS_AUTH_BASE = 'https://account.withings.com';

class WithingsApiError extends Error {
  constructor(public status: number, public action: string, message: string) {
    super(message);
    this.name = 'WithingsApiError';
  }
}

async function withingsPost(action: string, accessToken: string, params: Record<string, string> = {}): Promise<any> {
  const body = new URLSearchParams({
    action,
    ...params
  });

  const res = await fetch(`${WITHINGS_API_BASE}/v2/measure`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const data = await res.json();
  if (data.status !== 0) {
    console.error(`[WithingsService] API error ${data.status} for ${action}:`, data);
    throw new WithingsApiError(data.status, action, `Withings API error ${data.status}`);
  }
  return data.body;
}

export const withingsService = {
  /**
   * Generates the Withings OAuth authorization URL.
   * Scopes: user.activity (calories, steps), user.metrics (weight)
   */
  getAuthUrl(userId: string): string {
    const clientId = process.env.NEXT_PUBLIC_WITHINGS_CLIENT_ID || '';
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:9002';
    const redirectUri = `${origin}/api/auth/withings/callback`;
    const scope = 'user.activity,user.metrics';
    const state = encodeURIComponent(JSON.stringify({ uid: userId, redirect: redirectUri }));
    
    return `${WITHINGS_AUTH_BASE}/oauth2_user/authorize2?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${state}`;
  },

  /**
   * Exchanges an authorization code for access + refresh tokens.
   */
  async exchangeCodeForTokens(code: string, redirectUri: string): Promise<WithingsCredentials | null> {
    const clientId = process.env.NEXT_PUBLIC_WITHINGS_CLIENT_ID;
    const clientSecret = process.env.WITHINGS_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      console.warn('[WithingsService] Missing credentials.');
      return null;
    }

    const res = await fetch(`${WITHINGS_API_BASE}/v2/oauth2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        action: 'requesttoken',
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });

    if (!res.ok) {
      console.error('[WithingsService] Token exchange failed:', res.status, await res.text());
      return null;
    }

    const data = await res.json() as WithingsTokenResponse;
    if (data.status !== 0) {
      console.error('[WithingsService] Token exchange status error:', data.status);
      return null;
    }

    return {
      accessToken: data.body.access_token,
      refreshToken: data.body.refresh_token,
      withingsUserId: data.body.userid,
      expiresAt: Date.now() + data.body.expires_in * 1000,
    };
  },

  /**
   * Refreshes the access token using the stored refresh token.
   */
  async refreshAccessToken(refreshToken: string): Promise<WithingsCredentials | null> {
    const clientId = process.env.NEXT_PUBLIC_WITHINGS_CLIENT_ID;
    const clientSecret = process.env.WITHINGS_CLIENT_SECRET;

    if (!clientId || !clientSecret) return null;

    const res = await fetch(`${WITHINGS_API_BASE}/v2/oauth2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        action: 'requesttoken',
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }).toString(),
    });

    if (!res.ok) {
      console.error('[WithingsService] Token refresh failed:', res.status, await res.text());
      return null;
    }

    const data = await res.json() as WithingsTokenResponse;
    if (data.status !== 0) return null;

    return {
      accessToken: data.body.access_token,
      refreshToken: data.body.refresh_token,
      withingsUserId: data.body.userid,
      expiresAt: Date.now() + data.body.expires_in * 1000,
    };
  },

  /**
   * Fetches today's calorie data and steps.
   */
  async syncTodayData(accessToken: string, localDate?: string): Promise<WithingsSyncResult> {
    const targetDate = localDate || new Date().toISOString().split('T')[0];
    
    try {
      // Withings getactivity returns an array of activities for the requested period
      const activityData = await withingsPost('getactivity', accessToken, {
        startdateymd: targetDate,
        enddateymd: targetDate,
        data_fields: 'steps,calories,totalcalories'
      });

      const dayActivity = activityData.activities?.[0];
      const steps = dayActivity?.steps ?? 0;
      const calories = dayActivity?.totalcalories ?? dayActivity?.calories ?? 0;

      return {
        success: true,
        steps: { value: steps, source: 'device' },
        caloriesOut: { value: calories, source: 'device' },
        isVerified: true,
        dataDate: targetDate
      };
    } catch (err) {
      console.error('[WithingsService] Sync failed:', err);
      return { success: false, isVerified: true };
    }
  },

  /**
   * Fetches weight data from measure v2
   */
  async getLatestWeight(accessToken: string): Promise<number | undefined> {
    try {
      const data = await withingsPost('getmeas', accessToken, {
        meastype: '1', // Weight
        category: '1', // Real measures
        limit: '1'
      });
      
      const measure = data.measuregrps?.[0]?.measures?.[0];
      if (measure) {
        // Value is measure.value * 10^measure.unit
        return measure.value * Math.pow(10, measure.unit);
      }
    } catch (err) {
      console.warn('[WithingsService] Could not fetch weight:', err);
    }
    return undefined;
  }
};

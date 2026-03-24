
/**
 * @fileOverview Oura Ring service for the CFO audit.
 * Manages hardware verification and cloud-to-cloud synchronization
 * using the Oura V2 REST API.
 */

import { Firestore } from 'firebase/firestore';
import { healthService, OuraCredentials } from '@/lib/health-service';

export interface OuraMetric {
  value: number;
  source: 'device' | 'manual';
}

export interface OuraSyncResult {
  success: boolean;
  steps: OuraMetric;
  sleep: OuraMetric;
  hrv: OuraMetric;
  caloriesOut?: OuraMetric;
  isVerified: boolean;
}

export interface OuraInitialSyncResult extends OuraSyncResult {
  weightKg?: number;
  heightCm?: number;
  dataDate?: string;
}

interface OuraTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

const OURA_API_BASE = 'https://api.ouraring.com';
const OURA_AUTH_BASE = 'https://cloud.ouraring.com';

function toOuraDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

class OuraApiError extends Error {
  constructor(public status: number, public endpoint: string, message: string) {
    super(message);
    this.name = 'OuraApiError';
  }
}

async function ouraFetch(endpoint: string, accessToken: string): Promise<unknown | null> {
  const res = await fetch(`${OURA_API_BASE}${endpoint}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[OuraService] API error ${res.status} for ${endpoint}:`, body);
    throw new OuraApiError(res.status, endpoint, `Oura API ${res.status} on ${endpoint}: ${body}`);
  }
  return res.json();
}

export const ouraService = {
  /**
   * Generates the Oura OAuth authorization URL.
   * Scopes: daily (activity/sleep summaries), sleep (HRV in session data), personal (weight/height).
   */
  getAuthUrl(userId: string): string {
    const clientId = process.env.NEXT_PUBLIC_OURA_CLIENT_ID || 'MOCK_OURA_ID';
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:9002';
    const redirectUri = `${origin}/api/auth/oura/callback`;
    const scope = 'daily sleep personal';
    const state = encodeURIComponent(JSON.stringify({ uid: userId, redirect: redirectUri }));
    return `${OURA_AUTH_BASE}/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${state}`;
  },

  /**
   * Exchanges an authorization code for access + refresh tokens.
   * Falls back to mock credentials if env vars are absent.
   */
  async exchangeCodeForTokens(
    code: string,
    redirectUri: string
  ): Promise<OuraCredentials | null> {
    const clientId = process.env.NEXT_PUBLIC_OURA_CLIENT_ID;
    const clientSecret = process.env.OURA_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      console.warn('[OuraService] Missing credentials — running in mock mode.');
      return {
        accessToken: 'mock_oura_token',
        refreshToken: 'mock_oura_refresh',
        ouraUserId: 'mock_oura_user',
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      };
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch(`${OURA_API_BASE}/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ code, grant_type: 'authorization_code', redirect_uri: redirectUri }).toString(),
    });

    if (!res.ok) {
      console.error('[OuraService] Token exchange failed:', res.status, await res.text());
      return null;
    }

    const data = await res.json() as OuraTokenResponse;
    // Derive a stable user ID from the token response (Oura doesn't return user_id in token response)
    // We'll fetch it separately or use a placeholder derived from the token itself.
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      ouraUserId: 'oura_user', // populated after initial sync via personal_info
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  },

  /**
   * Refreshes the access token using the stored refresh token.
   */
  async refreshAccessToken(refreshToken: string): Promise<OuraCredentials | null> {
    const clientId = process.env.NEXT_PUBLIC_OURA_CLIENT_ID;
    const clientSecret = process.env.OURA_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      console.warn('[OuraService] Cannot refresh — no credentials. Still in mock mode.');
      return null;
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch(`${OURA_API_BASE}/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
    });

    if (!res.ok) {
      console.error('[OuraService] Token refresh failed:', res.status, await res.text());
      return null;
    }

    const data = await res.json() as OuraTokenResponse;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      ouraUserId: 'oura_user',
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  },

  /**
   * Fetches today's steps, sleep, and HRV from the Oura V2 API.
   * - daily_activity → steps, total_calories
   * - sleep          → total_sleep_duration (seconds), average_hrv (ms)
   */
  async syncTodayData(accessToken: string, localDate?: string): Promise<OuraSyncResult> {
    const targetDate = localDate || new Date().toISOString().split('T')[0];
    if (accessToken === 'mock_oura_token') {
      return {
        success: true,
        steps: { value: 7841, source: 'device' },
        sleep: { value: 7.5, source: 'device' },
        hrv: { value: 58, source: 'device' },
        caloriesOut: { value: 2450, source: 'device' },
        isVerified: true,
      };
    }

    const [activityData, sleepData] = await Promise.all([
      ouraFetch(`/v2/usercollection/daily_activity?start_date=${targetDate}&end_date=${targetDate}`, accessToken),
      ouraFetch(`/v2/usercollection/sleep?start_date=${targetDate}&end_date=${targetDate}`, accessToken),
    ]);

    const activityRecord = (activityData as any)?.data?.[0];
    const steps = activityRecord?.steps ?? 0;
    const totalCalories = activityRecord?.total_calories ?? 0;

    // Pick the long sleep session (main night sleep) for the target date
    const sleepSessions: any[] = (sleepData as any)?.data ?? [];
    const mainSleep = sleepSessions.find((s: any) => s.type === 'long_sleep') ?? sleepSessions[0];
    const totalSleepSeconds = mainSleep?.total_sleep_duration ?? 0;
    const avgHrv = mainSleep?.average_hrv ?? 0;

    return {
      success: true,
      steps: { value: steps, source: 'device' },
      sleep: { value: totalSleepSeconds / 3600, source: 'device' },
      hrv: { value: Math.round(avgHrv), source: 'device' },
      caloriesOut: { value: totalCalories, source: 'device' },
      isVerified: true,
    };
  },

  /**
   * Initial sync on first Oura connect. Fetches last 7 days of data
   * plus personal info (weight, height) so the dashboard has real data immediately.
   */
  async syncInitialData(accessToken: string): Promise<OuraInitialSyncResult> {
    if (accessToken === 'mock_oura_token') {
      return {
        success: true,
        steps: { value: 7841, source: 'device' },
        sleep: { value: 7.5, source: 'device' },
        hrv: { value: 58, source: 'device' },
        caloriesOut: { value: 2450, source: 'device' },
        weightKg: 78,
        heightCm: 178,
        isVerified: true,
      };
    }

    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const startDate = toOuraDate(weekAgo);
    const endDate = toOuraDate(today);

    const [activityData, sleepData, personalData] = await Promise.all([
      ouraFetch(`/v2/usercollection/daily_activity?start_date=${startDate}&end_date=${endDate}`, accessToken),
      ouraFetch(`/v2/usercollection/sleep?start_date=${startDate}&end_date=${endDate}`, accessToken),
      ouraFetch('/v2/usercollection/personal_info', accessToken).catch(() => null),
    ]);

    // Walk backwards through activity to find most recent day with steps > 0
    const activityRecords: any[] = [...((activityData as any)?.data ?? [])].reverse();
    let bestSteps = 0;
    let bestCalories = 0;
    let dataDate: string | undefined;
    for (const record of activityRecords) {
      if ((record.steps ?? 0) > 0) {
        bestSteps = record.steps;
        bestCalories = record.total_calories ?? 0;
        dataDate = record.day;
        break;
      }
    }

    // Walk backwards through sleep sessions to find most recent long sleep
    const sleepSessions: any[] = [...((sleepData as any)?.data ?? [])].reverse();
    let bestSleepSeconds = 0;
    let bestHrv = 0;
    for (const session of sleepSessions) {
      if (session.type === 'long_sleep' && (session.total_sleep_duration ?? 0) > 0) {
        bestSleepSeconds = session.total_sleep_duration;
        bestHrv = Math.round(session.average_hrv ?? 0);
        break;
      }
    }

    // Personal info: weight in kg, height in meters (convert to cm)
    const personal = personalData as any;
    const weightKg = personal?.weight ? parseFloat(personal.weight) : undefined;
    const heightCm = personal?.height ? Math.round(parseFloat(personal.height) * 100) : undefined;

    return {
      success: true,
      steps: { value: bestSteps, source: 'device' },
      sleep: { value: bestSleepSeconds / 3600, source: 'device' },
      hrv: { value: bestHrv, source: 'device' },
      caloriesOut: { value: bestCalories, source: 'device' },
      weightKg,
      heightCm,
      dataDate,
      isVerified: true,
    };
  },

  /**
   * Loads stored credentials, refreshes if near expiry, syncs today's data,
   * and persists updated tokens if refreshed.
   */
  async syncWithStoredTokens(db: Firestore, userId: string): Promise<OuraSyncResult | null> {
    let creds = await healthService.getOuraCredentials(db, userId);
    if (!creds) return null;

    const fiveMinutes = 5 * 60 * 1000;
    if (Date.now() + fiveMinutes >= creds.expiresAt) {
      const refreshed = await ouraService.refreshAccessToken(creds.refreshToken);
      if (!refreshed) return null;
      creds = { ...refreshed, ouraUserId: creds.ouraUserId };
      await healthService.saveOuraCredentials(db, userId, creds);
    }

    return ouraService.syncTodayData(creds.accessToken);
  },
};

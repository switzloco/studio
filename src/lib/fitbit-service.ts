
/**
 * @fileOverview Fitbit service for the CFO audit.
 * Manages hardware verification and cloud-to-cloud synchronization.
 */

import { Firestore } from 'firebase/firestore';
import { healthService, FitbitCredentials, FitbitActivity } from '@/lib/health-service';

export interface FitbitMetric {
  value: number;
  source: 'device' | 'manual';
}

export interface FitbitSyncResult {
  success: boolean;
  steps: FitbitMetric;
  sleep: FitbitMetric;
  hrv: FitbitMetric;
  caloriesOut?: FitbitMetric;
  activities?: FitbitActivity[];
  isVerified: boolean;
}

/** Extended result returned on initial connect — includes profile + history. */
export interface FitbitInitialSyncResult extends FitbitSyncResult {
  weightKg?: number;
  heightCm?: number;
  /** Most recent day that had actual data (YYYY-MM-DD), if any. */
  dataDate?: string;
  /** Per-day snapshots for the last 7 days, keyed by YYYY-MM-DD. */
  dailySnapshots?: Record<string, import('./health-service').FitbitDailySnapshot>;
}

interface FitbitTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: string;
}

/** Format a Date as YYYY-MM-DD for Fitbit API date params. */
function toFitbitDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export class FitbitApiError extends Error {
  constructor(public status: number, public endpoint: string, message: string, public body?: string) {
    super(message);
    this.name = 'FitbitApiError';
  }
}

async function fitbitFetch(endpoint: string, accessToken: string): Promise<unknown | null> {
  const res = await fetch(`https://api.fitbit.com${endpoint}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 204) return null; // no data for today
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[FitbitService] API error ${res.status} for ${endpoint}:`, body);
    throw new FitbitApiError(res.status, endpoint, `Fitbit API ${res.status} on ${endpoint}`, body);
  }
  return res.json();
}

/**
 * Google Fit REST API v1 — aggregate endpoint.
 * Uses a single daily bucket so we get one rolled-up value per metric.
 * @param dataTypeName e.g. 'com.google.step_count.delta'
 * @param startTimeMillis  UTC ms for window start (local midnight is best)
 * @param endTimeMillis    UTC ms for window end
 */
async function googleFitAggregate(
  dataTypeName: string,
  accessToken: string,
  startTimeMillis: number,
  endTimeMillis: number,
): Promise<any> {
  const res = await fetch(
    'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        aggregateBy: [{ dataTypeName }],
        bucketByTime: { durationMillis: endTimeMillis - startTimeMillis },
        startTimeMillis,
        endTimeMillis,
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[FitbitService] Google Fit API error ${res.status} for ${dataTypeName}:`, body);
    throw new FitbitApiError(res.status, `googlefit:${dataTypeName}`, `Google Fit API ${res.status}`, body);
  }
  return res.json();
}

/** Sum all intVal data points across every bucket in a Google Fit aggregate response. */
function fitSumInt(data: any): number {
  let total = 0;
  for (const bucket of (data?.bucket ?? [])) {
    for (const dataset of (bucket?.dataset ?? [])) {
      for (const point of (dataset?.point ?? [])) {
        total += point?.value?.[0]?.intVal ?? 0;
      }
    }
  }
  return total;
}

/** Sum all fpVal data points across every bucket in a Google Fit aggregate response. */
function fitSumFp(data: any): number {
  let total = 0;
  for (const bucket of (data?.bucket ?? [])) {
    for (const dataset of (bucket?.dataset ?? [])) {
      for (const point of (dataset?.point ?? [])) {
        total += point?.value?.[0]?.fpVal ?? 0;
      }
    }
  }
  return total;
}

/**
 * Compute total sleep duration in seconds from a Google Fit sleep segment response.
 * Sleep segment intVal type codes:
 *   1 = Awake (within sleep cycle — do NOT count)
 *   2 = Sleep (generic / unclassified — count)
 *   3 = Out of bed (do NOT count)
 *   4 = Light sleep (count)
 *   5 = Deep sleep (count)
 *   6 = REM (count)
 */
function fitSleepSeconds(data: any): number {
  const SLEEP_TYPES = new Set([2, 4, 5, 6]);
  let totalSec = 0;
  for (const bucket of (data?.bucket ?? [])) {
    for (const dataset of (bucket?.dataset ?? [])) {
      for (const point of (dataset?.point ?? [])) {
        const sleepType = point?.value?.[0]?.intVal ?? 0;
        if (SLEEP_TYPES.has(sleepType)) {
          const startMs = Math.round(Number(point.startTimeNanos) / 1_000_000);
          const endMs   = Math.round(Number(point.endTimeNanos)   / 1_000_000);
          totalSec += (endMs - startMs) / 1000;
        }
      }
    }
  }
  return totalSec;
}

/**
 * Convert a YYYY-MM-DD local date string to UTC millisecond boundaries.
 * Adjusts for the user's local timezone offset so the window matches their local day.
 * @param dateStr YYYY-MM-DD
 * @param timezoneOffset Minutes (UTC - local). e.g. 420 for PDT.
 */
function dateToUtcMs(dateStr: string, timezoneOffset: number = 0): { startMs: number; endMs: number } {
  const [y, m, d] = dateStr.split('-').map(Number);
  // Date.UTC(y, m-1, d) is midnight UTC on that date.
  // Adding timezoneOffset (in minutes) shifts it to the local midnight in UTC ms.
  const startMs = Date.UTC(y, m - 1, d) + (timezoneOffset * 60 * 1000);
  return { startMs, endMs: startMs + 86_400_000 };
}

/**
 * Map Google Fit activity type IDs → human-readable names.
 * Full list: https://developers.google.com/fit/rest/v1/reference/activity-types
 */
const GOOGLE_FIT_ACTIVITY_TYPES: Record<number, string> = {
  0: 'In Vehicle', 1: 'Biking', 2: 'On Foot', 3: 'Still', 4: 'Unknown',
  5: 'Tilting', 7: 'Walking', 8: 'Running', 9: 'Aerobics', 10: 'Badminton',
  11: 'Baseball', 12: 'Basketball', 13: 'Biathlon', 14: 'Handbiking',
  15: 'Mountain Biking', 16: 'Road Biking', 17: 'Spinning', 18: 'Stationary Biking',
  19: 'Utility Biking', 20: 'Boxing', 21: 'Calisthenics', 22: 'Circuit Training',
  23: 'Cricket', 24: 'Cross Country Skiing', 25: 'Cross Fit', 26: 'Curling',
  27: 'Dancing', 28: 'Diving', 29: 'Elliptical', 30: 'Fencing',
  31: 'Football (American)', 32: 'Football (Australian)', 33: 'Football (Soccer)',
  34: 'Frisbee', 35: 'Gardening', 36: 'Golf', 37: 'Gymnastics',
  38: 'Handball', 39: 'Hiking', 40: 'Hockey', 41: 'Horseback Riding',
  42: 'Housework', 43: 'Jumping Rope', 44: 'Kayaking', 45: 'Kettlebell Training',
  46: 'Kickboxing', 47: 'Kitesurfing', 48: 'Martial Arts', 49: 'Meditation',
  50: 'Mixed Martial Arts', 51: 'P90X', 52: 'Paragliding', 53: 'Pilates',
  54: 'Polo', 55: 'Racquetball', 56: 'Rock Climbing', 57: 'Rowing',
  58: 'Rowing Machine', 59: 'Rugby', 60: 'Jogging', 61: 'Running on Sand',
  62: 'Running (Treadmill)', 63: 'Sailing', 64: 'Scuba Diving',
  65: 'Skateboarding', 66: 'Skating', 67: 'Cross Skating', 68: 'Indoor Skating',
  69: 'Inline Skating', 70: 'Skiing', 71: 'Back Country Skiing',
  72: 'Downhill Skiing', 73: 'Kite Skiing', 74: 'Nordic Skiing',
  75: 'Snowboarding', 76: 'Snowmobile', 77: 'Snowshoeing',
  78: 'Squash', 79: 'Stair Climbing', 80: 'Stair Climbing Machine',
  81: 'Stand Up Paddleboarding', 82: 'Strength Training', 83: 'Surfing',
  84: 'Swimming (Open Water)', 85: 'Swimming (Pool)', 86: 'Table Tennis',
  87: 'Team Sports', 88: 'Tennis', 89: 'Treadmill (Walking)',
  90: 'Volleyball (Beach)', 91: 'Volleyball (Indoor)', 92: 'Wakeboarding',
  93: 'Walking (Fitness)', 94: 'NNordic Walking', 95: 'Walking (Treadmill)',
  96: 'Waterpolo', 97: 'Weightlifting', 98: 'Wheelchair', 99: 'Windsurfing',
  100: 'Yoga', 101: 'Zumba', 108: 'Diving', 109: 'Ergometer',
  110: 'Ice Skating', 111: 'Indoor Cycling', 112: 'Stairmaster',
  113: 'HIIT', 114: 'Interval Training', 116: 'Walking', 117: 'Swimming',
};

// Maps lowercase Fitbit activity names → accuracy tier for calorie discount.
// Default (unrecognized): tier2_steady_state.
const ACTIVITY_TIER_MAP: Record<string, FitbitActivity['activityTier']> = {
  walk: 'tier1_walking', walking: 'tier1_walking', 'outdoor walk': 'tier1_walking',
  hike: 'tier1_walking', hiking: 'tier1_walking',
  yoga: 'tier1_walking', stretch: 'tier1_walking', pilates: 'tier1_walking',
  run: 'tier2_steady_state', running: 'tier2_steady_state', 'outdoor run': 'tier2_steady_state',
  jog: 'tier2_steady_state', jogging: 'tier2_steady_state',
  bike: 'tier2_steady_state', biking: 'tier2_steady_state', cycling: 'tier2_steady_state', 'outdoor bike': 'tier2_steady_state',
  swim: 'tier2_steady_state', swimming: 'tier2_steady_state',
  elliptical: 'tier2_steady_state', rowing: 'tier2_steady_state', row: 'tier2_steady_state',
  treadmill: 'tier2_steady_state', 'stair climber': 'tier2_steady_state',
  weights: 'tier3_anaerobic', 'weight training': 'tier3_anaerobic', 'strength training': 'tier3_anaerobic',
  kettlebell: 'tier3_anaerobic', crossfit: 'tier3_anaerobic',
  hiit: 'tier3_anaerobic', 'interval training': 'tier3_anaerobic', 'circuit training': 'tier3_anaerobic',
  sport: 'tier3_anaerobic', soccer: 'tier3_anaerobic', basketball: 'tier3_anaerobic',
  tennis: 'tier3_anaerobic', volleyball: 'tier3_anaerobic', football: 'tier3_anaerobic',
  'martial arts': 'tier3_anaerobic', boxing: 'tier3_anaerobic',
};

function classifyActivityTier(
  name: string,
  peakMinutes?: number,
  cardioMinutes?: number,
  avgHr?: number,
): FitbitActivity['activityTier'] {
  // HR-zone override when zones confirm elevated intensity.
  if (peakMinutes != null && cardioMinutes != null) {
    if (peakMinutes + cardioMinutes >= 10) return 'tier3_anaerobic';
    if (peakMinutes + cardioMinutes >= 2) return 'tier2_steady_state';
    // Don't return tier1 here — zero cardio/peak could mean the activities
    // list API didn't return heartRateZones, not that intensity was truly low.
  }
  // Average HR as secondary signal when zone data is absent or ambiguous.
  if (avgHr != null) {
    if (avgHr >= 150) return 'tier3_anaerobic';
    if (avgHr >= 120) return 'tier2_steady_state';
    return 'tier1_walking';
  }
  return ACTIVITY_TIER_MAP[name.toLowerCase()] ?? 'tier2_steady_state';
}

/**
 * Fetches Fitbit auto-detected activities for a specific date.
 * Silently returns [] on failure — non-critical for glycogen fallback.
 */
async function fetchActivitiesForDate(
  accessToken: string, 
  date: string, 
  provider: 'fitbit' | 'google' = 'fitbit',
  timezoneOffset?: number
): Promise<FitbitActivity[]> {
  if (accessToken === 'mock_token') return [];
  try {
    if (provider === 'google') {
      // Use a wide window (prev midnight → next midnight UTC) so we don't clip
      // activities that straddle a local midnight boundary.
      const { startMs, endMs } = dateToUtcMs(date, timezoneOffset);
      const data = await googleFitAggregate('com.google.activity.segment', accessToken, startMs, endMs);
      const activities: FitbitActivity[] = [];

      for (const bucket of (data?.bucket ?? [])) {
        for (const dataset of (bucket?.dataset ?? [])) {
          for (const point of (dataset?.point ?? [])) {
            const activityTypeId = point?.value?.[0]?.intVal ?? 0;
            const startMs2 = Math.round(Number(point.startTimeNanos) / 1_000_000);
            const endMs2   = Math.round(Number(point.endTimeNanos)   / 1_000_000);
            const durationMin = Math.round((endMs2 - startMs2) / 60_000);

            // Skip trivially short segments (GPS drift, brief pauses, etc.)
            if (durationMin < 5) continue;

            const activityName = GOOGLE_FIT_ACTIVITY_TYPES[activityTypeId] ?? 'Exercise';
            const startDate = new Date(startMs2);
            const hh = String(startDate.getUTCHours()).padStart(2, '0');
            const mm = String(startDate.getUTCMinutes()).padStart(2, '0');

            activities.push({
              activityName,
              startTime: `${hh}:${mm}`,
              durationMin,
              // Google Fit activity segments don't carry calorie data — that
              // lives in com.google.calories.expended. Leave 0; calories come
              // from the daily total in syncTodayData.
              calories: 0,
              activityTier: classifyActivityTier(activityName),
            } satisfies FitbitActivity);
          }
        }
      }
      return activities;
    }

    const data = await fitbitFetch(
      `/1/user/-/activities/list.json?afterDate=${date}&sort=asc&limit=20&offset=0`,
      accessToken,
    );
    const raw: any[] = (data as any)?.activities ?? [];
    return raw
      .filter((a: any) => {
        if (!a.startTime) return false;
        return new Date(a.startTime).toLocaleDateString('en-CA') === date;
      })
      .map((a: any) => {
        const d = new Date(a.startTime);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        const zones = (a.heartRateZones as any[]) ?? [];
        const peak = zones.find((z: any) => z.name === 'Peak')?.minutes ?? 0;
        const cardio = zones.find((z: any) => z.name === 'Cardio')?.minutes ?? 0;
        return {
          activityName: a.activityName || 'Unknown',
          startTime: `${hh}:${mm}`,
          durationMin: Math.round((a.duration || 0) / 60000),
          calories: a.calories || 0,
          averageHeartRate: a.averageHeartRate || undefined,
          activityTier: classifyActivityTier(a.activityName || '', peak, cardio, a.averageHeartRate || undefined),
        } satisfies FitbitActivity;
      });
  } catch (e) {
    console.warn('[FitbitService] fetchActivitiesForDate failed (non-critical):', e);
    return [];
  }
}

export const fitbitService = {
  /**
   * Generates the authorization URL for the client.
   */
  getAuthUrl(userId: string, provider: 'fitbit' | 'google' = 'fitbit'): string {
    const clientId = process.env.NEXT_PUBLIC_FITBIT_CLIENT_ID || 'MOCK_ID';
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:9002';
    const redirectUri = `${origin}/api/auth/fitbit/callback`;
    const timezoneOffset = typeof window !== 'undefined' ? new Date().getTimezoneOffset() : 0;
    const state = encodeURIComponent(JSON.stringify({ 
      uid: userId, 
      redirect: redirectUri, 
      provider,
      tz: timezoneOffset 
    }));

    if (provider === 'google') {
      const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_HEALTH_CLIENT_ID || clientId;
      // Google Fit REST API scopes (fitness.* namespace)
      const scopes = [
        'https://www.googleapis.com/auth/fitness.activity.read',
        'https://www.googleapis.com/auth/fitness.sleep.read',
        'https://www.googleapis.com/auth/fitness.heart_rate.read',
        'https://www.googleapis.com/auth/fitness.body.read',
      ].join(' ');
      return `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${googleClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${state}&access_type=offline&prompt=consent`;
    }

    const scope = 'activity heartrate sleep profile';
    return `https://api.fitbit.com/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&expires_in=31536000&state=${state}`;
  },

  /**
   * Exchanges an authorization code for access + refresh tokens.
   * Falls back to mock credentials if env vars are absent.
   */
  async exchangeCodeForTokens(
    code: string,
    redirectUri: string,
    provider: 'fitbit' | 'google' = 'google'
  ): Promise<FitbitCredentials | null> {
    if (provider === 'google') {
      const clientId = process.env.NEXT_PUBLIC_GOOGLE_HEALTH_CLIENT_ID?.trim();
      const clientSecret = process.env.GOOGLE_HEALTH_CLIENT_SECRET?.trim();
      if (!clientId || !clientSecret) {
        console.warn('[FitbitService] Missing Google credentials — running in mock mode.');
        return {
          accessToken: 'mock_token',
          refreshToken: 'mock_refresh',
          fitbitUserId: 'mock_google_user',
          expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
          provider: 'google'
        };
      }

      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code'
        }).toString()
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => 'No body');
        console.error(`[FitbitService] Google Token exchange failed: Status ${res.status}, Body: ${errorBody}`);
        return null;
      }

      const data = await res.json();
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        fitbitUserId: 'google_health_user',
        expiresAt: Date.now() + data.expires_in * 1000,
        provider: 'google'
      };
    }

    const clientId = process.env.NEXT_PUBLIC_FITBIT_CLIENT_ID?.trim();
    const clientSecret = process.env.FITBIT_CLIENT_SECRET?.trim();

    if (!clientId || !clientSecret) {
      console.warn('[FitbitService] Missing credentials (clientId or clientSecret is null/empty) — running in mock mode.');
      return {
        accessToken: 'mock_token',
        refreshToken: 'mock_refresh',
        fitbitUserId: 'mock_fitbit_user',
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        provider: 'fitbit'
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
      const errorBody = await res.text().catch(() => 'No body');
      console.error(`[FitbitService] Token exchange failed: Status ${res.status}, Body: ${errorBody}. Code: ${code.substring(0, 5)}..., Redirect: ${redirectUri}`);
      return null;
    }

    const data = await res.json() as FitbitTokenResponse;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      fitbitUserId: data.user_id,
      expiresAt: Date.now() + data.expires_in * 1000,
      provider: 'fitbit'
    };
  },

  /**
   * Uses the refresh token to get a new access token before it expires.
   */
  async refreshAccessToken(refreshToken: string, provider: 'fitbit' | 'google' = 'fitbit'): Promise<FitbitCredentials | null> {
    if (provider === 'google') {
      const clientId = process.env.NEXT_PUBLIC_GOOGLE_HEALTH_CLIENT_ID?.trim();
      const clientSecret = process.env.GOOGLE_HEALTH_CLIENT_SECRET?.trim();

      if (!clientId || !clientSecret) {
        console.warn(`[FitbitService] Cannot refresh Google token — missing credentials (clientId: ${!!clientId}, clientSecret: ${!!clientSecret})`);
        return null;
      }

      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret
        }).toString()
      });

      if (!res.ok) {
        console.error('[FitbitService] Google Token refresh failed:', res.status, await res.text());
        return null;
      }

      const data = await res.json();
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken,
        fitbitUserId: 'google_health_user',
        expiresAt: Date.now() + data.expires_in * 1000,
        provider: 'google'
      };
    }

    const clientId = process.env.NEXT_PUBLIC_FITBIT_CLIENT_ID;
    const clientSecret = process.env.FITBIT_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      console.warn(`[FitbitService] Cannot refresh Fitbit token — missing credentials (clientId: ${!!clientId}, clientSecret: ${!!clientSecret})`);
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
      provider: 'fitbit'
    };
  },

  /**
   * Fetches today's steps, sleep, and HRV from the Fitbit Web API.
   * Uses the provided localDate (YYYY-MM-DD) or 'today'.
   * Returns mock data if the token is the dev mock.
   */
  async syncTodayData(
    accessToken: string, 
    localDate?: string, 
    provider: 'fitbit' | 'google' = 'fitbit',
    timezoneOffset?: number
  ): Promise<FitbitSyncResult> {
    const targetDate = localDate || new Date().toISOString().split('T')[0];
    if (accessToken === 'mock_token') {
      return {
        success: true,
        steps: { value: 8432, source: 'device' },
        sleep: { value: 7.2, source: 'device' },
        hrv: { value: 62, source: 'device' },
        isVerified: true,
      };
    }

    if (provider === 'google') {
      // UTC ms window for steps/calories — strict 24 h anchored to UTC midnight.
      const { startMs, endMs } = dateToUtcMs(targetDate, timezoneOffset);
      // Sleep window is wider (−6 h / +12 h) so overnight sessions that start
      // before local midnight aren't clipped by the UTC boundary.
      const sleepStartMs = startMs - 6 * 3_600_000;
      const sleepEndMs   = endMs   + 12 * 3_600_000;

      const [stepsData, sleepData, caloriesData, bmrData, activities] = await Promise.all([
        googleFitAggregate('com.google.step_count.delta',  accessToken, startMs,      endMs),
        googleFitAggregate('com.google.sleep.segment',     accessToken, sleepStartMs,  sleepEndMs),
        googleFitAggregate('com.google.calories.expended', accessToken, startMs,      endMs),
        googleFitAggregate('com.google.calories.bmr',      accessToken, startMs,      endMs),
        fetchActivitiesForDate(accessToken, targetDate, 'google', timezoneOffset),
      ]);

      const stepsCount  = fitSumInt(stepsData);
      const expended    = fitSumFp(caloriesData);
      const bmr         = fitSumFp(bmrData);
      // Samsung Health via Health Connect writes only active calories to
      // com.google.calories.expended (BMR is missing). Native Google Fit
      // already includes BMR. Detect which case we're in: if expended < BMR
      // it can only be active-only, so add BMR to get total TDEE.
      const caloriesOut = Math.round(expended > bmr ? expended : expended + bmr);
      const sleepSec    = fitSleepSeconds(sleepData);

      // Google Fit has no HRV data type — omit hrv so the metabolic engine
      // runs at its neutral default (hrvMultiplier = 1.0). Recovery status is
      // derived from sleep hours by the caller (fitbit-sync.ts).
      return {
        success: true,
        steps:      { value: stepsCount,        source: 'device' },
        sleep:      { value: sleepSec / 3600,   source: 'device' },
        hrv:        { value: 0,                 source: 'device' },
        caloriesOut: caloriesOut > 0 ? { value: caloriesOut, source: 'device' } : undefined,
        activities: activities.length > 0 ? activities : undefined,
        isVerified: true,
      };
    }

    const [activitiesData, sleepData, hrvData, activities] = await Promise.all([
      fitbitFetch(`/1/user/-/activities/date/${targetDate}.json`, accessToken),
      fitbitFetch(`/1.2/user/-/sleep/date/${targetDate}.json`, accessToken),
      fitbitFetch(`/1/user/-/hrv/date/${targetDate}.json`, accessToken),
      fetchActivitiesForDate(accessToken, targetDate, 'fitbit'),
    ]);

    const steps = (activitiesData as any)?.summary?.steps ?? 0;
    const caloriesOut = (activitiesData as any)?.summary?.caloriesOut ?? 0;
    const totalMinutesAsleep = (sleepData as any)?.summary?.totalMinutesAsleep ?? 0;
    const dailyRmssd = (hrvData as any)?.hrv?.[0]?.value?.dailyRmssd ?? 0;

    return {
      success: true,
      steps: { value: steps, source: 'device' },
      sleep: { value: totalMinutesAsleep / 60, source: 'device' },
      hrv: { value: Math.round(dailyRmssd), source: 'device' },
      caloriesOut: { value: caloriesOut, source: 'device' },
      activities: activities.length > 0 ? activities : undefined,
      isVerified: true,
    };
  },

  /**
   * Initial sync on first Fitbit connect. Fetches the last 7 days of
   * steps/sleep/HRV plus the user profile (weight, height) so the
   * dashboard has real data immediately — even if the device hasn't
   * synced yet today.  Falls back to today-only if time-series fails.
   */
  async syncInitialData(accessToken: string, provider: 'fitbit' | 'google' = 'fitbit', timezoneOffset?: number): Promise<FitbitInitialSyncResult> {
    if (accessToken === 'mock_token') {
      return {
        success: true,
        steps: { value: 8432, source: 'device' },
        sleep: { value: 7.2, source: 'device' },
        hrv: { value: 62, source: 'device' },
        weightKg: 80,
        heightCm: 175,
        isVerified: true,
      };
    }

    if (provider === 'google') {
      const now = new Date();
      const localTime = new Date(now.getTime() - ((timezoneOffset || 0) * 60000));
      const todayDate = localTime;
      const todayStr  = todayDate.toISOString().split('T')[0];

      // Backfill the last 7 days so the dashboard has history immediately
      // after connecting — mirrors what the Fitbit initial sync does.
      const dailySnapshots: Record<string, import('./health-service').FitbitDailySnapshot> = {};
      let latestResult: FitbitSyncResult | null = null;

      for (let i = 0; i < 7; i++) {
        const d = new Date(todayDate);
        d.setUTCDate(d.getUTCDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        try {
          const r = await this.syncTodayData(accessToken, dateStr, 'google', timezoneOffset);
          dailySnapshots[dateStr] = {
            steps:        r.steps.value,
            sleepHours:   r.sleep.value,
            // No HRV from Google Fit — derive recoveryStatus from sleep
            recoveryStatus: r.sleep.value >= 7 ? 'high' : r.sleep.value >= 6 ? 'medium' : 'low',
            caloriesOut:  r.caloriesOut?.value,
            activities:   r.activities,
          };
          if (i === 0) latestResult = r;
        } catch (dayErr) {
          console.warn(`[FitbitService] Google initial sync: skipping ${dateStr}:`, dayErr);
        }
      }

      // Fetch body composition — weight in kg, height in metres (×100 → cm)
      const { startMs: bodyStart, endMs: bodyEnd } = dateToUtcMs(todayStr, timezoneOffset); 
      const [weightData, heightData] = await Promise.all([
        googleFitAggregate('com.google.weight', accessToken, bodyStart - 30 * 86_400_000, bodyEnd),
        googleFitAggregate('com.google.height', accessToken, bodyStart - 30 * 86_400_000, bodyEnd),
      ]);
      const weightKg = fitSumFp(weightData) > 0 ? Math.round(fitSumFp(weightData) * 10) / 10 : undefined;
      const heightM  = fitSumFp(heightData) > 0 ? fitSumFp(heightData) : undefined;

      const base = latestResult ?? {
        success: true,
        steps: { value: 0, source: 'device' as const },
        sleep: { value: 0, source: 'device' as const },
        hrv:   { value: 0, source: 'device' as const },
        isVerified: true,
      };

      return {
        ...base,
        weightKg,
        heightCm: heightM ? Math.round(heightM * 100) : undefined,
        dataDate: todayStr,
        dailySnapshots,
      };
    }

    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const startDate = toFitbitDate(weekAgo);
    const endDate = toFitbitDate(today);

    const [stepsData, sleepData, hrvData, profileData] = await Promise.all([
      fitbitFetch(`/1/user/-/activities/steps/date/${startDate}/${endDate}.json`, accessToken),
      fitbitFetch(`/1.2/user/-/sleep/date/${startDate}/${endDate}.json`, accessToken),
      fitbitFetch(`/1/user/-/hrv/date/${startDate}/${endDate}.json`, accessToken),
      fitbitFetch('/1/user/-/profile.json', accessToken),
    ]);

    const stepsSeries: { dateTime: string; value: string }[] = (stepsData as any)?.['activities-steps'] ?? [];
    let bestSteps = 0;
    let dataDate: string | undefined;
    for (let i = stepsSeries.length - 1; i >= 0; i--) {
      const v = parseInt(stepsSeries[i].value, 10);
      if (v > 0) {
        bestSteps = v;
        dataDate = stepsSeries[i].dateTime;
        break;
      }
    }

    const sleepRecords: any[] = (sleepData as any)?.sleep ?? [];
    let bestSleepMinutes = 0;
    for (let i = sleepRecords.length - 1; i >= 0; i--) {
      if (sleepRecords[i].isMainSleep && sleepRecords[i].minutesAsleep > 0) {
        bestSleepMinutes = sleepRecords[i].minutesAsleep;
        break;
      }
    }

    const hrvSeries: any[] = (hrvData as any)?.hrv ?? [];
    let bestHrv = 0;
    for (let i = hrvSeries.length - 1; i >= 0; i--) {
      const rmssd = hrvSeries[i]?.value?.dailyRmssd;
      if (rmssd && rmssd > 0) {
        bestHrv = Math.round(rmssd);
        break;
      }
    }

    const profile = (profileData as any)?.user;
    return {
      success: true,
      steps: { value: bestSteps, source: 'device' },
      sleep: { value: bestSleepMinutes / 60, source: 'device' },
      hrv: { value: bestHrv, source: 'device' },
      weightKg: profile?.weight ? parseFloat(profile.weight) : undefined,
      heightCm: profile?.height ? parseFloat(profile.height) : undefined,
      dataDate,
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
    const provider = creds.provider || 'fitbit';
    if (Date.now() + fiveMinutes >= creds.expiresAt) {
      const refreshed = await fitbitService.refreshAccessToken(creds.refreshToken, provider);
      if (!refreshed) return null;
      creds = { ...refreshed, fitbitUserId: creds.fitbitUserId, provider };
      await healthService.saveFitbitCredentials(db, userId, creds);
    }

    return fitbitService.syncTodayData(creds.accessToken, undefined, provider, creds.timezoneOffset);
  },
};

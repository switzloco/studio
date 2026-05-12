
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

class FitbitApiError extends Error {
  constructor(public status: number, public endpoint: string, message: string) {
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
    throw new FitbitApiError(res.status, endpoint, `Fitbit API ${res.status} on ${endpoint}: ${body}`);
  }
  return res.json();
}

/**
 * Helper for Google Health API v4 requests.
 */
async function googleHealthFetch(dataType: string, accessToken: string, filter?: string): Promise<any> {
  let url = `https://health.googleapis.com/v4/users/me/dataTypes/${dataType}/dataPoints`;
  if (filter) {
    url += `?filter=${encodeURIComponent(filter)}`;
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[FitbitService] Google Health API error ${res.status} for ${dataType}:`, body);
    throw new FitbitApiError(res.status, url, `Google Health API ${res.status}: ${body}`);
  }
  return res.json();
}

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
async function fetchActivitiesForDate(accessToken: string, date: string, provider: 'fitbit' | 'google' = 'fitbit'): Promise<FitbitActivity[]> {
  if (accessToken === 'mock_token') return [];
  try {
    if (provider === 'google') {
      const startTime = `${date}T00:00:00Z`;
      const endTime = `${date}T23:59:59Z`;
      const filter = `exercise.interval.start_time >= "${startTime}" AND exercise.interval.start_time <= "${endTime}"`;
      const data = await googleHealthFetch('exercise', accessToken, filter);
      const points = (data as any)?.dataPoints ?? [];

      return points.map((p: any) => {
        const ex = p.exercise;
        const start = new Date(ex.interval.startTime);
        return {
          activityName: ex.exerciseType || 'Unknown',
          startTime: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`,
          durationMin: Math.round((new Date(ex.interval.endTime).getTime() - start.getTime()) / 60000),
          calories: ex.calories || 0,
          averageHeartRate: ex.averageHeartRate || undefined,
          activityTier: classifyActivityTier(ex.exerciseType || '', undefined, undefined, ex.averageHeartRate),
        } satisfies FitbitActivity;
      });
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
  getAuthUrl(userId: string, provider: 'fitbit' | 'google' = 'google'): string {
    const clientId = process.env.NEXT_PUBLIC_FITBIT_CLIENT_ID || 'MOCK_ID';
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:9002';
    const redirectUri = `${origin}/api/auth/fitbit/callback`;
    const state = encodeURIComponent(JSON.stringify({ uid: userId, redirect: redirectUri, provider }));

    if (provider === 'google') {
      const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_HEALTH_CLIENT_ID || clientId;
      const scopes = [
        'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
        'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
        'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
        'https://www.googleapis.com/auth/googlehealth.profile.readonly'
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
        console.warn('[FitbitService] Cannot refresh — no Google credentials. Mock mode.');
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
      provider: 'fitbit'
    };
  },

  /**
   * Fetches today's steps, sleep, and HRV from the Fitbit Web API.
   * Uses the provided localDate (YYYY-MM-DD) or 'today'.
   * Returns mock data if the token is the dev mock.
   */
  async syncTodayData(accessToken: string, localDate?: string, provider: 'fitbit' | 'google' = 'fitbit'): Promise<FitbitSyncResult> {
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
      const startTime = `${targetDate}T00:00:00Z`;
      const endTime = `${targetDate}T23:59:59Z`;

      const [stepsData, sleepData, hrvData, caloriesData, activities] = await Promise.all([
        googleHealthFetch('steps', accessToken, `steps.interval.start_time >= "${startTime}" AND steps.interval.start_time <= "${endTime}"`),
        googleHealthFetch('sleep', accessToken, `sleep.interval.start_time >= "${startTime}" AND sleep.interval.start_time <= "${endTime}"`),
        googleHealthFetch('daily-heart-rate-variability', accessToken, `daily_heart_rate_variability.interval.start_time >= "${startTime}" AND daily_heart_rate_variability.interval.start_time <= "${endTime}"`),
        googleHealthFetch('total-calories', accessToken, `total_calories.interval.start_time >= "${startTime}" AND total_calories.interval.start_time <= "${endTime}"`),
        fetchActivitiesForDate(accessToken, targetDate, 'google'),
      ]);

      const stepsCount = (stepsData as any)?.dataPoints?.reduce((acc: number, p: any) => acc + (p.steps?.count || 0), 0) ?? 0;
      const caloriesOut = (caloriesData as any)?.dataPoints?.reduce((acc: number, p: any) => acc + (p.totalCalories?.calories || 0), 0) ?? 0;
      const sleepDurationSec = (sleepData as any)?.dataPoints?.[0]?.sleep?.sleepSummary?.totalSleepDuration || 0;
      const hrvValue = (hrvData as any)?.dataPoints?.[0]?.dailyHeartRateVariability?.rmssd || 0;

      return {
        success: true,
        steps: { value: stepsCount, source: 'device' },
        sleep: { value: sleepDurationSec / 3600, source: 'device' },
        hrv: { value: Math.round(hrvValue), source: 'device' },
        caloriesOut: { value: caloriesOut, source: 'device' },
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
  async syncInitialData(accessToken: string, provider: 'fitbit' | 'google' = 'fitbit'): Promise<FitbitInitialSyncResult> {
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
      const today = new Date().toISOString().split('T')[0];
      const result = await this.syncTodayData(accessToken, today, 'google');
      const [weightData, heightData] = await Promise.all([
        googleHealthFetch('weight', accessToken),
        googleHealthFetch('height', accessToken),
      ]);

      const weight = (weightData as any)?.dataPoints?.[0]?.weight?.kilograms;
      const height = (heightData as any)?.dataPoints?.[0]?.height?.centimeters;

      return {
        ...result,
        weightKg: weight,
        heightCm: height,
        dataDate: today,
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

    return fitbitService.syncTodayData(creds.accessToken, undefined, provider);
  },
};

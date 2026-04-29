
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
async function fetchActivitiesForDate(accessToken: string, date: string): Promise<FitbitActivity[]> {
  if (accessToken === 'mock_token') return [];
  try {
    const data = await fitbitFetch(
      `/1/user/-/activities/list.json?afterDate=${date}&sort=asc&limit=20&offset=0`,
      accessToken,
    );
    const raw: any[] = (data as any)?.activities ?? [];
    return raw
      .filter((a: any) => {
        if (!a.startTime) return false;
        // Only include activities whose local start date matches the target date.
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
  getAuthUrl(userId: string): string {
    const clientId = process.env.NEXT_PUBLIC_FITBIT_CLIENT_ID || 'MOCK_ID';
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:9002';
    const redirectUri = `${origin}/api/auth/fitbit/callback`;
    const scope = 'activity heartrate sleep profile';
    // Encode both userId and the exact redirectUri in state so the callback
    // uses the identical redirect_uri for the token exchange (prevents mismatch).
    const state = encodeURIComponent(JSON.stringify({ uid: userId, redirect: redirectUri }));
    // expires_in=2592000 requests a 30-day access token (Fitbit max).
    // Without this parameter Fitbit defaults to 8 hours, forcing daily reconnects
    // when the background cron isn't running or FITBIT_CLIENT_SECRET is missing.
    return `https://www.fitbit.com/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&expires_in=2592000&state=${state}`;
  },

  /**
   * Exchanges an authorization code for access + refresh tokens.
   * Falls back to mock credentials if env vars are absent.
   */
  async exchangeCodeForTokens(
    code: string,
    redirectUri: string
  ): Promise<FitbitCredentials | null> {
    const clientId = process.env.NEXT_PUBLIC_FITBIT_CLIENT_ID?.trim();
    const clientSecret = process.env.FITBIT_CLIENT_SECRET?.trim();

    if (!clientId || !clientSecret) {
      console.warn('[FitbitService] Missing credentials (clientId or clientSecret is null/empty) — running in mock mode.');
      return {
        accessToken: 'mock_token',
        refreshToken: 'mock_refresh',
        fitbitUserId: 'mock_fitbit_user',
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
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
   * Uses the provided localDate (YYYY-MM-DD) or 'today'.
   * Returns mock data if the token is the dev mock.
   */
  async syncTodayData(accessToken: string, localDate?: string): Promise<FitbitSyncResult> {
    // Fitbit API requires YYYY-MM-DD — it does NOT accept 'today' as a keyword.
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

    // Fetch all endpoints in parallel. Individual endpoints may return null (204 /
    // no data today) — that's fine. If a request throws (auth error, rate limit)
    // we let it propagate so the caller knows. Activities are non-critical:
    // failure is caught inside fetchActivitiesForDate and returns [].
    const [activitiesData, sleepData, hrvData, activities] = await Promise.all([
      fitbitFetch(`/1/user/-/activities/date/${targetDate}.json`, accessToken),
      fitbitFetch(`/1.2/user/-/sleep/date/${targetDate}.json`, accessToken),
      fitbitFetch(`/1/user/-/hrv/date/${targetDate}.json`, accessToken),
      fetchActivitiesForDate(accessToken, targetDate),
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
  async syncInitialData(accessToken: string): Promise<FitbitInitialSyncResult> {
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

    // Steps: time series returns { "activities-steps": [{ dateTime, value }] }
    // Walk backwards to find the most recent day with steps > 0.
    const stepsSeries: { dateTime: string; value: string }[] =
      (stepsData as any)?.['activities-steps'] ?? [];
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

    // Sleep: array of sleep records — pick the most recent main sleep.
    const sleepRecords: any[] = (sleepData as any)?.sleep ?? [];
    let bestSleepMinutes = 0;
    for (let i = sleepRecords.length - 1; i >= 0; i--) {
      if (sleepRecords[i].isMainSleep && sleepRecords[i].minutesAsleep > 0) {
        bestSleepMinutes = sleepRecords[i].minutesAsleep;
        break;
      }
    }

    // HRV: { hrv: [{ dateTime, value: { dailyRmssd } }] }
    const hrvSeries: any[] = (hrvData as any)?.hrv ?? [];
    let bestHrv = 0;
    for (let i = hrvSeries.length - 1; i >= 0; i--) {
      const rmssd = hrvSeries[i]?.value?.dailyRmssd;
      if (rmssd && rmssd > 0) {
        bestHrv = Math.round(rmssd);
        break;
      }
    }

    // Profile: weight in kg, height in cm
    const profile = (profileData as any)?.user;
    const weightKg = profile?.weight ? parseFloat(profile.weight) : undefined;
    const heightCm = profile?.height ? parseFloat(profile.height) : undefined;

    // Fetch per-day activity summaries (calories) for each date in the range.
    // These can't be fetched as a single time-series for caloriesOut (TDEE),
    // so we batch 7 individual calls in parallel — well within the free-tier rate limit.
    const dates: string[] = [];
    for (let d = new Date(weekAgo); d <= today; d.setDate(d.getDate() + 1)) {
      dates.push(toFitbitDate(new Date(d)));
    }
    const activityByDate = await Promise.all(
      dates.map(date =>
        fitbitFetch(`/1/user/-/activities/date/${date}.json`, accessToken)
          .catch(() => null)
          .then(data => ({ date, data }))
      )
    );

    // Build per-day snapshot map — steps from time series, calories from daily summary,
    // sleep from sleep records keyed by date, HRV from HRV series keyed by date.
    const sleepByDate: Record<string, number> = {};
    for (const rec of sleepRecords) {
      if (rec.isMainSleep && rec.minutesAsleep > 0 && rec.dateOfSleep) {
        sleepByDate[rec.dateOfSleep] = rec.minutesAsleep;
      }
    }
    const hrvByDate: Record<string, number> = {};
    for (const entry of hrvSeries) {
      const rmssd = entry?.value?.dailyRmssd;
      if (rmssd > 0 && entry.dateTime) {
        hrvByDate[entry.dateTime] = Math.round(rmssd);
      }
    }
    const stepsMap: Record<string, number> = {};
    for (const entry of stepsSeries) {
      const v = parseInt(entry.value, 10);
      if (v > 0) stepsMap[entry.dateTime] = v;
    }

    const dailySnapshots: Record<string, import('./health-service').FitbitDailySnapshot> = {};
    let bestCalories = 0;
    for (const { date, data } of activityByDate) {
      const caloriesOut = (data as any)?.summary?.caloriesOut ?? 0;
      const steps = stepsMap[date] ?? 0;
      const sleepMinutes = sleepByDate[date] ?? 0;
      const hrv = hrvByDate[date] ?? 0;
      // Only write a snapshot if we have at least one meaningful data point.
      if (steps > 0 || sleepMinutes > 0 || hrv > 0 || caloriesOut > 0) {
        const snap: import('./health-service').FitbitDailySnapshot = {};
        if (steps > 0) snap.steps = steps;
        if (sleepMinutes > 0) snap.sleepHours = sleepMinutes / 60;
        if (hrv > 0) {
          snap.hrv = hrv;
          snap.recoveryStatus = hrv >= 50 ? 'high' : hrv >= 30 ? 'medium' : 'low';
        }
        if (caloriesOut > 0) {
          snap.caloriesOut = Math.round(caloriesOut * 0.90); // same 10% Fitbit adjustment
        }
        dailySnapshots[date] = snap;
      }
      // Track the most recent day's calories for the main health doc.
      if (date === endDate && caloriesOut > 0) {
        bestCalories = Math.round(caloriesOut * 0.90);
      }
    }

    return {
      success: true,
      steps: { value: bestSteps, source: 'device' },
      sleep: { value: bestSleepMinutes / 60, source: 'device' },
      hrv: { value: bestHrv, source: 'device' },
      caloriesOut: { value: bestCalories, source: 'device' },
      weightKg,
      heightCm,
      dataDate,
      dailySnapshots,
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

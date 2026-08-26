
/**
 * @fileOverview Fitbit service for the CFO audit.
 * Manages hardware verification and cloud-to-cloud synchronization.
 */

import { Firestore } from 'firebase/firestore';
import { healthService, FitbitCredentials, FitbitActivity, HealthMetricAvailability } from '@/lib/health-service';

export type { HealthMetricAvailability };

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
  /**
   * Which energy data type `caloriesOut` was read from. `active-only` means the
   * device published activity burn but no BMR, so the figure is NOT a full-day
   * total — the caller has to make up the basal half.
   */
  caloriesBasis?: CaloriesBasis;
  /**
   * Metrics the provider had no trustworthy value for on this sync. A `0` in
   * one of those fields means "unknown", not "none" — see
   * {@link HealthMetricAvailability}.
   */
  unavailable?: HealthMetricAvailability;
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

// ─── Google Health API v4 ───────────────────────────────────────────────────
// Reference: https://developers.google.com/health/reference/rest/v4
//
// Two request shapes matter here, and both differ from the Fitbit Web API:
//
//   • dailyRollUp (POST) — daily totals aggregated over CIVIL days, i.e. the
//     user's own calendar days. The body takes a CivilTimeInterval:
//         { range: { start: { date: { year, month, day } },
//                    end:   { date: { year, month, day } } },   // end exclusive
//           windowSizeDays: 1 }
//     The range fields are `start`/`end` — sending `startTime`/`endTime` gets a
//     400 "Invalid JSON payload received. Unknown name \"startTime\" at 'range'".
//     `windowSizeDays` is documented as optional but the live API 400s without it.
//
//   • list / reconcile (GET) — individual points selected with an AIP-160
//     `filter`. Only `>=` and `<` are supported (never `<=` or `>`), and the
//     civil-time fields reject a timezone designator, so their literals are
//     plain `YYYY-MM-DD` with no trailing `Z`. Per data type:
//         steps    → steps.interval.civil_start_time
//         exercise → exercise.interval.civil_start_time
//         sleep    → sleep.interval.civil_end_time   (end time only)
//         weight   → weight.sample_time.civil_time
//
// Because everything is expressed in civil days, no UTC-offset arithmetic is
// needed: the local date string IS the query.

const GOOGLE_HEALTH_BASE = 'https://health.googleapis.com/v4/users/me/dataTypes';

/** YYYY-MM-DD → { year, month, day } for a CivilDateTime. */
function toCivilDate(dateStr: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateStr.split('-').map(Number);
  return { year, month, day };
}

/** YYYY-MM-DD ± n days → YYYY-MM-DD. Pure calendar arithmetic, no zone drift. */
function addDaysToIsoDate(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/** AIP-160 filter selecting one civil day on `field`. `date` is YYYY-MM-DD. */
function civilDayFilter(field: string, date: string): string {
  return `${field} >= "${date}" AND ${field} < "${addDaysToIsoDate(date, 1)}"`;
}

/** AIP-160 filter over a closed-open civil-date range. */
function civilRangeFilter(field: string, startDate: string, endDateExclusive: string): string {
  return `${field} >= "${startDate}" AND ${field} < "${endDateExclusive}"`;
}

/** protobuf JSON encodes int64 as a string and double as a number. */
function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Seconds from a google-duration string such as "-25200s". */
function parseDurationSeconds(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = parseFloat(value.replace(/s$/, ''));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Daily totals for one data type over a closed-open civil-date range.
 * `endDate` is exclusive, so a single day is (date, date + 1 day).
 *
 * Throws {@link FitbitApiError} on any non-2xx: callers MUST distinguish
 * "the API failed" from "the user has no data" — treating both as 0 is what
 * overwrote real history with zeroes.
 */
async function googleHealthDailyRollUp(
  dataType: string,
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<any> {
  const res = await fetch(`${GOOGLE_HEALTH_BASE}/${dataType}/dataPoints:dailyRollUp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      range: {
        start: { date: toCivilDate(startDate) },
        end: { date: toCivilDate(endDate) },
      },
      windowSizeDays: 1,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(
      `[GoogleHealth] dailyRollUp ${res.status} for ${dataType} ${startDate}→${endDate}:`,
      body,
    );
    throw new FitbitApiError(
      res.status,
      `googlehealth:${dataType}:dailyRollUp`,
      `Google Health API ${res.status} on ${dataType}:dailyRollUp`,
      body,
    );
  }
  return res.json();
}

/**
 * Reconciled (multi-source-merged) data points matching an AIP-160 filter.
 * Follows `nextPageToken`. Throws {@link FitbitApiError} on any non-2xx.
 */
async function googleHealthReconcile(
  dataType: string,
  accessToken: string,
  filter: string,
  pageSize?: number,
): Promise<{ dataPoints: any[] }> {
  const allPoints: any[] = [];
  let pageToken = '';
  let pageCount = 0;
  const MAX_PAGES = 50;

  do {
    const params = new URLSearchParams({ filter });
    if (pageSize) params.set('pageSize', String(pageSize));
    if (pageToken) params.set('pageToken', pageToken);

    const res = await fetch(
      `${GOOGLE_HEALTH_BASE}/${dataType}/dataPoints:reconcile?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[GoogleHealth] reconcile ${res.status} for ${dataType} (${filter}):`, body);
      throw new FitbitApiError(
        res.status,
        `googlehealth:${dataType}:reconcile`,
        `Google Health API ${res.status} on ${dataType}:reconcile`,
        body,
      );
    }

    const data = await res.json();
    if (Array.isArray(data?.dataPoints)) allPoints.push(...data.dataPoints);
    pageToken = data?.nextPageToken || '';
    pageCount++;
  } while (pageToken && pageCount < MAX_PAGES);

  if (pageToken) {
    console.warn(
      `[GoogleHealth] reconcile hit the ${MAX_PAGES}-page limit for ${dataType}; kept ${allPoints.length} points`,
    );
  }

  return { dataPoints: allPoints };
}

/** Rollup buckets that actually carry a value for `key` (absent ≠ zero). */
function rollupBuckets(data: any, key: string): any[] {
  const points: any[] = data?.rollupDataPoints ?? [];
  return points.filter((p) => p?.[key] != null);
}

/**
 * Total steps from a dailyRollUp (`steps.countSum`, int64-as-string) or from
 * raw list/reconcile points (`steps.count`).
 */
function parseHealthSteps(data: any): number {
  if (!data) return 0;
  let total = 0;
  for (const p of data?.rollupDataPoints ?? []) {
    total += toNumber(p?.steps?.countSum);
  }
  for (const p of data?.dataPoints ?? []) {
    total += toNumber(p?.steps?.count);
  }
  return Math.round(total);
}

/** Sum a dailyRollUp's `kcalSum` for one energy data type. */
function parseRollupKcal(data: any, key: 'totalCalories' | 'activeEnergyBurned'): number {
  let total = 0;
  for (const p of data?.rollupDataPoints ?? []) {
    total += toNumber(p?.[key]?.kcalSum);
  }
  return total;
}

/** Sum `basal-energy-burned` points (per-interval `kcal`, no rollup support). */
function parseBasalKcal(data: any): number {
  let total = 0;
  for (const p of data?.dataPoints ?? []) {
    total += toNumber(p?.basalEnergyBurned?.kcal);
  }
  return total;
}

/**
 * Where a day's calorie burn came from. `total-calories` is the direct answer,
 * but not every device publishes it — some write only the two halves. Knowing
 * which we got is what lets the caller decide whether anything is missing,
 * instead of quietly estimating the difference.
 */
export type CaloriesBasis = 'total' | 'active+basal' | 'active-only';

/**
 * A day's calorie burn, read from whichever of the three energy data types the
 * device actually publishes:
 *   • `total-calories`      — BMR + active, the whole day in one number;
 *   • `active-energy-burned`— activity only (dailyRollUp);
 *   • `basal-energy-burned` — BMR only (list/reconcile; it has no rollup).
 *
 * The halves should add up to the total, so whichever is larger is the more
 * complete reading — a `total-calories` stream the device only partly fills in
 * is exactly how a 3,100 kcal day gets reported as 1,900. Returns null when no
 * source produced anything, and throws only when all three reads failed
 * outright (that is an API problem, not an empty day).
 */
async function readGoogleHealthCalories(
  accessToken: string,
  date: string,
  nextDate: string,
): Promise<{ kcal: number; basis: CaloriesBasis } | null> {
  const errors: unknown[] = [];
  const read = async <T>(label: string, request: Promise<T>): Promise<T | null> => {
    try {
      return await request;
    } catch (err: any) {
      console.warn(`[GoogleHealth] ${label} fetch failed for ${date}:`, err?.message ?? err);
      errors.push(err);
      return null;
    }
  };

  const [totalRollup, activeRollup, basalPoints] = await Promise.all([
    read('total-calories', googleHealthDailyRollUp('total-calories', accessToken, date, nextDate)),
    read('active-energy-burned', googleHealthDailyRollUp('active-energy-burned', accessToken, date, nextDate)),
    read(
      'basal-energy-burned',
      googleHealthReconcile(
        'basal-energy-burned',
        accessToken,
        civilDayFilter('basal_energy_burned.interval.civil_start_time', date),
      ),
    ),
  ]);

  if (errors.length === 3) throw errors[0];

  const total = parseRollupKcal(totalRollup, 'totalCalories');
  const active = parseRollupKcal(activeRollup, 'activeEnergyBurned');
  const basal = parseBasalKcal(basalPoints);
  const halves = basal + active;

  let result: { kcal: number; basis: CaloriesBasis } | null = null;
  if (halves > 0 && halves >= total) {
    result = { kcal: Math.round(halves), basis: basal > 0 ? 'active+basal' : 'active-only' };
  } else if (total > 0) {
    result = { kcal: Math.round(total), basis: 'total' };
  }

  console.log(
    `[GoogleHealth] calories for ${date}: total=${Math.round(total)} active=${Math.round(active)} ` +
    `basal=${Math.round(basal)} → ${result ? `${result.kcal} kcal (${result.basis})` : 'no data'}`,
  );

  return result;
}

/**
 * Sleep hours from `sleep` session points. Prefers the API's own
 * `summary.minutesAsleep` (int64-as-string) and falls back to summing the
 * non-awake stages for sessions the stage algorithm hasn't finished yet.
 */
function parseHealthSleepHours(data: any): number {
  const points: any[] = data?.dataPoints ?? [];
  let totalMinutes = 0;

  for (const point of points) {
    const sleep = point?.sleep ?? point;

    const summaryMinutes = toNumber(sleep?.summary?.minutesAsleep);
    if (summaryMinutes > 0) {
      totalMinutes += summaryMinutes;
      continue;
    }

    const stages: any[] = sleep?.stages ?? [];
    let stageMinutes = 0;
    for (const stage of stages) {
      const type = String(stage?.type ?? '');
      if (type === 'AWAKE' || type === 'OUT_OF_BED' || type === 'UNKNOWN') continue;
      const start = Date.parse(stage?.startTime ?? '');
      const end = Date.parse(stage?.endTime ?? '');
      if (end > start) stageMinutes += (end - start) / 60_000;
    }
    if (stageMinutes > 0) {
      totalMinutes += stageMinutes;
      continue;
    }

    // Classic (stage-less) sleep: the session interval is the whole record.
    const start = Date.parse(sleep?.interval?.startTime ?? '');
    const end = Date.parse(sleep?.interval?.endTime ?? '');
    if (end > start) totalMinutes += (end - start) / 60_000;
  }

  return Math.round((totalMinutes / 60) * 10) / 10;
}

/** "STRENGTH_TRAINING" → "Strength Training". */
function humanizeExerciseType(type: string): string {
  return type
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Workouts from `exercise` session points. */
function parseHealthExercises(data: any): FitbitActivity[] {
  const points: any[] = data?.dataPoints ?? [];
  const activities: FitbitActivity[] = [];

  for (const point of points) {
    const exercise = point?.exercise ?? point;
    const interval = exercise?.interval ?? {};
    const start = Date.parse(interval?.startTime ?? '');
    const end = Date.parse(interval?.endTime ?? '');
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;

    const activeSeconds = parseDurationSeconds(exercise?.activeDuration);
    const durationMin = Math.round(
      (activeSeconds > 0 ? activeSeconds * 1000 : end - start) / 60_000,
    );
    if (durationMin < 5) continue;

    const name =
      exercise?.displayName ||
      (exercise?.exerciseType ? humanizeExerciseType(String(exercise.exerciseType)) : 'Exercise');

    // startTime is a true UTC instant; startUtcOffset puts it back in the
    // user's local wall clock, which is what the activity list displays.
    const localStart = new Date(start + parseDurationSeconds(interval?.startUtcOffset) * 1000);
    const hh = String(localStart.getUTCHours()).padStart(2, '0');
    const mm = String(localStart.getUTCMinutes()).padStart(2, '0');

    const metrics = exercise?.metricsSummary ?? {};
    const avgHr = toNumber(metrics?.averageHeartRateBeatsPerMinute) || undefined;

    activities.push({
      activityName: name,
      startTime: `${hh}:${mm}`,
      durationMin,
      calories: Math.round(toNumber(metrics?.caloriesKcal)),
      averageHeartRate: avgHr,
      activityTier: classifyActivityTier(name, undefined, undefined, avgHr),
    });
  }

  return activities;
}

/** The API caps `exercise` and `sleep` pages at 25 points. */
const SESSION_PAGE_SIZE = 25;

/**
 * Physical-time rollUp — aggregates over real instants rather than civil days,
 * with an explicit `windowSize` duration. Used by the calorie diagnostic to see
 * a day hour by hour; `dailyRollUp` can only bucket whole days.
 */
async function googleHealthRollUp(
  dataType: string,
  accessToken: string,
  startTimeIso: string,
  endTimeIso: string,
  windowSize = '3600s',
): Promise<any> {
  const res = await fetch(`${GOOGLE_HEALTH_BASE}/${dataType}/dataPoints:rollUp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ range: { startTime: startTimeIso, endTime: endTimeIso }, windowSize }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new FitbitApiError(
      res.status,
      `googlehealth:${dataType}:rollUp`,
      `Google Health API ${res.status} on ${dataType}:rollUp`,
      body,
    );
  }
  return res.json();
}

/**
 * Raw `:list` — unlike `:reconcile` it keeps each point's `dataSource`, which is
 * how you tell which device or app actually wrote a value.
 */
async function googleHealthList(
  dataType: string,
  accessToken: string,
  filter: string,
  pageSize = 1000,
): Promise<any> {
  const params = new URLSearchParams({ filter, pageSize: String(pageSize) });
  const res = await fetch(`${GOOGLE_HEALTH_BASE}/${dataType}/dataPoints?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new FitbitApiError(
      res.status,
      `googlehealth:${dataType}:list`,
      `Google Health API ${res.status} on ${dataType}:list`,
      body,
    );
  }
  return res.json();
}

/** Device or app that wrote a data point, for diagnostics. */
function pointSource(point: any): string {
  const ds = point?.dataSource;
  return ds?.device?.displayName || ds?.application?.packageName || 'unknown';
}

/**
 * Everything the API will say about a day's calorie burn, in one object.
 *
 * Reading `total-calories` alone cannot tell you whether a low number is the
 * whole story: the type is rollup-only, so its individual intervals can't be
 * listed. This cross-references it against the listable halves and against an
 * hourly breakdown, which is what distinguishes "the device reports a low
 * total" from "the total only covers part of the day".
 */
export async function diagnoseGoogleHealthCalories(
  accessToken: string,
  date: string,
  timezoneOffsetMinutes = 0,
  days = 7,
): Promise<Record<string, unknown>> {
  const nextDate = addDaysToIsoDate(date, 1);
  const seriesStart = addDaysToIsoDate(date, -(days - 1));

  // Physical-time bounds of the local day, for the hourly breakdown.
  const [y, m, d] = date.split('-').map(Number);
  const dayStartMs = Date.UTC(y, m - 1, d) + timezoneOffsetMinutes * 60_000;
  const dayStartIso = new Date(dayStartMs).toISOString();
  const dayEndIso = new Date(dayStartMs + 86_400_000).toISOString();

  const attempt = async <T>(label: string, run: () => Promise<T>): Promise<T | { error: string }> => {
    try {
      return await run();
    } catch (err: any) {
      return { error: `${label}: ${err?.message ?? String(err)}${err?.body ? ` — ${String(err.body).slice(0, 300)}` : ''}` };
    }
  };

  const [totalSeries, activeSeries, stepSeries, hourly, activePoints, basalPoints] = await Promise.all([
    attempt('total-calories series', () => googleHealthDailyRollUp('total-calories', accessToken, seriesStart, nextDate)),
    attempt('active-energy series', () => googleHealthDailyRollUp('active-energy-burned', accessToken, seriesStart, nextDate)),
    attempt('steps series', () => googleHealthDailyRollUp('steps', accessToken, seriesStart, nextDate)),
    attempt('total-calories hourly', () => googleHealthRollUp('total-calories', accessToken, dayStartIso, dayEndIso)),
    attempt('active-energy points', () =>
      googleHealthList('active-energy-burned', accessToken, civilDayFilter('active_energy_burned.interval.civil_start_time', date))),
    attempt('basal-energy points', () =>
      googleHealthList('basal-energy-burned', accessToken, civilDayFilter('basal_energy_burned.interval.civil_start_time', date))),
  ]);

  const byDate = (data: any, read: (p: any) => number) => {
    if (!data || 'error' in data) return data;
    const out: Record<string, number> = {};
    for (const p of data?.rollupDataPoints ?? []) {
      const civ = p?.civilStartTime?.date;
      if (!civ) continue;
      const key = `${civ.year}-${String(civ.month).padStart(2, '0')}-${String(civ.day).padStart(2, '0')}`;
      out[key] = Math.round(read(p));
    }
    return out;
  };

  const hourlyBuckets = hourly && !('error' in hourly)
    ? (hourly?.rollupDataPoints ?? [])
        .map((p: any) => ({ start: p?.startTime, kcal: Math.round(toNumber(p?.totalCalories?.kcalSum)) }))
        .filter((b: any) => b.kcal > 0)
    : hourly;

  const summarisePoints = (data: any, key: string) => {
    if (!data || 'error' in data) return data;
    const points: any[] = data?.dataPoints ?? [];
    return {
      count: points.length,
      kcalTotal: Math.round(points.reduce((sum, p) => sum + toNumber(p?.[key]?.kcal), 0)),
      sources: [...new Set(points.map(pointSource))],
      first: points[0]?.[key]?.interval?.startTime,
      last: points[points.length - 1]?.[key]?.interval?.endTime,
      sample: points.slice(0, 3),
    };
  };

  return {
    date,
    timezoneOffsetMinutes,
    dailySeries: {
      totalCalories: byDate(totalSeries, (p) => toNumber(p?.totalCalories?.kcalSum)),
      activeEnergyBurned: byDate(activeSeries, (p) => toNumber(p?.activeEnergyBurned?.kcalSum)),
      steps: byDate(stepSeries, (p) => toNumber(p?.steps?.countSum)),
    },
    totalCaloriesHourly: hourlyBuckets,
    activeEnergyBurned: summarisePoints(activePoints, 'activeEnergyBurned'),
    basalEnergyBurned: summarisePoints(basalPoints, 'basalEnergyBurned'),
  };
}

/** Numeric field of the most recent sample point (weight, height, …). */
function latestSampleValue(data: any, typeKey: string, field: string): number {
  const points: any[] = data?.dataPoints ?? [];
  let bestTime = -Infinity;
  let bestValue = 0;
  for (const point of points) {
    const sample = point?.[typeKey];
    if (!sample) continue;
    const t = Date.parse(sample?.sampleTime?.physicalTime ?? '');
    const time = Number.isFinite(t) ? t : -Infinity;
    if (time >= bestTime) {
      bestTime = time;
      bestValue = toNumber(sample?.[field]);
    }
  }
  return bestValue;
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
async function fetchActivitiesForDate(
  accessToken: string,
  date: string,
): Promise<FitbitActivity[]> {
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
   * Generates authorization URL using default origin.
   */
  getAuthUrl(userId: string, provider: 'fitbit' | 'google' = 'google'): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:9002';
    const redirectUri = `${origin}/api/auth/fitbit/callback`;
    return this.getAuthorizationUrl(userId, redirectUri, provider);
  },

  /**
   * Generates the authorization URL for the client.
   * Embeds userId + redirectUri in the OAuth state param so the callback
   * knows where to return and who to save tokens for.
   */
  getAuthorizationUrl(userId: string, redirectUri: string, provider: 'fitbit' | 'google' = 'google'): string {
    const clientId = process.env.NEXT_PUBLIC_FITBIT_CLIENT_ID;
    if (!clientId && provider === 'fitbit') {
      console.warn('[FitbitService] Missing NEXT_PUBLIC_FITBIT_CLIENT_ID — falling back to mock auth.');
      return `${redirectUri}?code=mock_code&state=${encodeURIComponent(JSON.stringify({ uid: userId, redirect: redirectUri }))}`;
    }

    const timezoneOffset = typeof window !== 'undefined' ? new Date().getTimezoneOffset() : 0;
    const state = encodeURIComponent(JSON.stringify({ 
      uid: userId, 
      redirect: redirectUri, 
      provider,
      tz: timezoneOffset 
    }));

    if (provider === 'google') {
      const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_HEALTH_CLIENT_ID || clientId;
      // Google Health API scopes (googlehealth.* namespace)
      const scopes = [
        'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
        'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
        'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
        'https://www.googleapis.com/auth/googlehealth.profile.readonly',
      ].join(' ');
      return `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${googleClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${state}&access_type=offline&prompt=consent`;
    }

    const scope = 'activity heartrate sleep profile';
    // The user-facing authorization page is served from www.fitbit.com. Hitting
    // api.fitbit.com for the authorize step bounces the browser to a defunct
    // /login/transferpage URL that 404s. (Token exchange still uses api.fitbit.com.)
    return `https://www.fitbit.com/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&expires_in=31536000&state=${state}`;
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
      // Google Health aggregates by CIVIL day, so the user's local date IS the
      // query — no UTC window arithmetic, and no timezone offset to get wrong.
      // Sleep is selected by the civil day it ENDS on: that is the only filter
      // the API supports for sleep, and it is also what "last night's sleep for
      // date D" means.
      const nextDate = addDaysToIsoDate(targetDate, 1);
      const unavailable: HealthMetricAvailability = {};
      const failures: unknown[] = [];

      const [stepsRollup, calories, sleepData, exerciseData] = await Promise.all([
        googleHealthDailyRollUp('steps', accessToken, targetDate, nextDate).catch((err) => {
          console.warn(`[GoogleHealth] steps fetch failed for ${targetDate}:`, err?.message ?? err);
          failures.push(err);
          unavailable.steps = true;
          return null;
        }),
        readGoogleHealthCalories(accessToken, targetDate, nextDate).catch((err) => {
          console.warn(`[GoogleHealth] calories fetch failed for ${targetDate}:`, err?.message ?? err);
          failures.push(err);
          unavailable.caloriesOut = true;
          return null;
        }),
        googleHealthReconcile(
          'sleep',
          accessToken,
          civilDayFilter('sleep.interval.civil_end_time', targetDate),
          SESSION_PAGE_SIZE,
        ).catch((err) => {
          console.warn(`[GoogleHealth] sleep fetch failed for ${targetDate}:`, err?.message ?? err);
          failures.push(err);
          unavailable.sleep = true;
          return null;
        }),
        googleHealthReconcile(
          'exercise',
          accessToken,
          civilDayFilter('exercise.interval.civil_start_time', targetDate),
          SESSION_PAGE_SIZE,
        ).catch((err) => {
          console.warn(`[GoogleHealth] exercise fetch failed for ${targetDate}:`, err?.message ?? err);
          unavailable.activities = true;
          return null;
        }),
      ]);

      // Every read failed — surface it as an API error rather than reporting a
      // successful all-zero sync that would overwrite good data downstream.
      if (unavailable.steps && unavailable.caloriesOut && unavailable.sleep) {
        throw failures[0];
      }

      let stepsCount = parseHealthSteps(stepsRollup);
      // A day with no rollup bucket is a day the device never synced — NOT a
      // zero-step day (a real zero comes back as countSum "0"). Fall back to
      // the raw interval stream before deciding we know nothing.
      if (!unavailable.steps && rollupBuckets(stepsRollup, 'steps').length === 0) {
        const rawSteps = await googleHealthReconcile(
          'steps',
          accessToken,
          civilDayFilter('steps.interval.civil_start_time', targetDate),
        ).catch((err) => {
          console.warn(`[GoogleHealth] steps reconcile fallback failed for ${targetDate}:`, err?.message ?? err);
          return null;
        });
        stepsCount = parseHealthSteps(rawSteps);
        if (stepsCount === 0) unavailable.steps = true;
      }

      const caloriesOut = calories?.kcal ?? 0;
      if (!calories) unavailable.caloriesOut = true;

      const sleepHours = parseHealthSleepHours(sleepData);
      // No sleep session recorded is "we don't know", not "slept 0 hours".
      if (!unavailable.sleep && sleepHours === 0) unavailable.sleep = true;

      const activities = parseHealthExercises(exerciseData);

      const unknown = Object.keys(unavailable);
      console.log(
        `[GoogleHealth] Sync result for ${targetDate}:`,
        {
          steps: stepsCount,
          caloriesOut,
          sleepHours,
          caloriesBasis: calories?.basis ?? 'none',
          activities: activities.length,
          unavailable: unknown.length > 0 ? unknown.join(',') : 'none',
        },
      );

      // Google Health API recovery status is derived from sleep hours by the caller (fitbit-sync.ts).
      return {
        success: true,
        steps:      { value: stepsCount,  source: 'device' },
        sleep:      { value: sleepHours,  source: 'device' },
        hrv:        { value: 0,           source: 'device' },
        caloriesOut: caloriesOut > 0 ? { value: caloriesOut, source: 'device' } : undefined,
        caloriesBasis: calories?.basis,
        activities: activities.length > 0 ? activities : undefined,
        isVerified: true,
        unavailable,
      };
    }

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
      // Local "today" for the user — Google Health queries are civil-day based,
      // so this date string is all the window we need.
      const now = new Date();
      const localTime = new Date(now.getTime() - ((timezoneOffset || 0) * 60000));
      const todayStr = localTime.toISOString().split('T')[0];

      // Backfill the last 7 days so the dashboard has history immediately
      // after connecting — mirrors what the Fitbit initial sync does.
      const dailySnapshots: Record<string, import('./health-service').FitbitDailySnapshot> = {};
      let latestResult: FitbitSyncResult | null = null;

      for (let i = 0; i < 7; i++) {
        const dateStr = addDaysToIsoDate(todayStr, -i);
        try {
          const r = await this.syncTodayData(accessToken, dateStr, 'google', timezoneOffset);
          if (i === 0) latestResult = r;

          // Only record what the provider actually knows. Writing an all-zero
          // snapshot here would clobber real history for that day.
          const snap: import('./health-service').FitbitDailySnapshot = {
            // Captured today; for i>0 (past days) this makes the snapshot final.
            capturedOnDate: todayStr,
          };
          if (!r.unavailable?.steps) snap.steps = r.steps.value;
          if (!r.unavailable?.sleep) {
            snap.sleepHours = r.sleep.value;
            // Derive recoveryStatus from sleep
            snap.recoveryStatus = r.sleep.value >= 7 ? 'high' : r.sleep.value >= 6 ? 'medium' : 'low';
          }
          if (r.caloriesOut && r.caloriesOut.value > 0) snap.caloriesOut = r.caloriesOut.value;
          if (r.activities && r.activities.length > 0) snap.activities = r.activities;

          if (snap.steps != null || snap.sleepHours != null || snap.caloriesOut != null || snap.activities) {
            dailySnapshots[dateStr] = snap;
          }
        } catch (dayErr) {
          console.warn(`[FitbitService] Google initial sync: skipping ${dateStr}:`, dayErr);
        }
      }

      // Body composition — the newest weight/height sample in the last 30 days.
      // These are sample types, filtered on their civil sample time.
      const bodyStart = addDaysToIsoDate(todayStr, -30);
      const bodyEnd = addDaysToIsoDate(todayStr, 1);
      const [weightData, heightData] = await Promise.all([
        googleHealthReconcile(
          'weight',
          accessToken,
          civilRangeFilter('weight.sample_time.civil_time', bodyStart, bodyEnd),
        ).catch((err) => {
          console.warn('[GoogleHealth] weight fetch failed:', err?.message ?? err);
          return null;
        }),
        googleHealthReconcile(
          'height',
          accessToken,
          civilRangeFilter('height.sample_time.civil_time', bodyStart, bodyEnd),
        ).catch((err) => {
          console.warn('[GoogleHealth] height fetch failed:', err?.message ?? err);
          return null;
        }),
      ]);

      const weightGrams = latestSampleValue(weightData, 'weight', 'weightGrams');
      const weightKg = weightGrams > 0 ? Math.round((weightGrams / 1000) * 10) / 10 : undefined;

      const heightMm = latestSampleValue(heightData, 'height', 'heightMillimeters');
      const heightCm = heightMm > 0 ? Math.round(heightMm / 10) : undefined;

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
        heightCm,
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

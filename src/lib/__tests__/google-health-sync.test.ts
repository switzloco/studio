import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fitbitService } from '../fitbit-service';

vi.mock('firebase/firestore', () => ({}));

/**
 * Route a fetch by data type, so each test only states the data it cares about.
 * Keys are matched against the URL as `/{dataType}/dataPoints`.
 */
function mockGoogleHealth(routes: Record<string, unknown | { status: number; body: unknown }>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const key = Object.keys(routes).find((k) => url.includes(`/${k}/dataPoints`));
      const route = key ? routes[key] : undefined;
      const isError = !!route && typeof route === 'object' && 'status' in (route as object);
      const status = isError ? (route as { status: number }).status : 200;
      const body = route === undefined
        ? { dataPoints: [], rollupDataPoints: [] }
        : isError ? (route as { body: unknown }).body : route;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    }),
  );
  return calls;
}

const civil = { date: { year: 2026, month: 8, day: 25 } };
const steps = (countSum: string) => ({ rollupDataPoints: [{ civilStartTime: civil, steps: { countSum } }] });
const totalCalories = (kcalSum: number) => ({ rollupDataPoints: [{ civilStartTime: civil, totalCalories: { kcalSum } }] });
const activeEnergy = (kcalSum: number) => ({ rollupDataPoints: [{ civilStartTime: civil, activeEnergyBurned: { kcalSum } }] });
const basalEnergy = (...kcals: number[]) => ({ dataPoints: kcals.map((kcal) => ({ basalEnergyBurned: { kcal } })) });
const sleep = (minutesAsleep: string) => ({
  dataPoints: [{
    sleep: {
      interval: { startTime: '2026-08-24T22:10:00Z', endTime: '2026-08-25T13:40:00Z' },
      summary: { minutesAsleep, minutesAwake: '30' },
    },
  }],
});

const healthyDay = {
  steps: steps('11530'),
  'total-calories': totalCalories(2842),
  sleep: sleep('432'),
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('Google Health sync — request shape', () => {
  it('sends a civil-date range and an explicit window size to dailyRollUp', async () => {
    const calls = mockGoogleHealth(healthyDay);
    await fitbitService.syncTodayData('token', '2026-08-25', 'google', 420);

    const rollup = calls.find((c) => c.url.includes('/steps/dataPoints:dailyRollUp'))!;
    expect(rollup.init?.method).toBe('POST');
    expect(JSON.parse(rollup.init!.body as string)).toEqual({
      range: {
        start: { date: { year: 2026, month: 8, day: 25 } },
        end: { date: { year: 2026, month: 8, day: 26 } },
      },
      windowSizeDays: 1,
    });
  });

  it('filters sleep on civil end time and exercise on civil start time, with no Z suffix', async () => {
    const calls = mockGoogleHealth(healthyDay);
    await fitbitService.syncTodayData('token', '2026-08-25', 'google', 420);

    const filterOf = (path: string) =>
      decodeURIComponent(new URL(calls.find((c) => c.url.includes(path))!.url).searchParams.get('filter')!);

    expect(filterOf('/sleep/dataPoints:reconcile')).toBe(
      'sleep.interval.civil_end_time >= "2026-08-25" AND sleep.interval.civil_end_time < "2026-08-26"',
    );
    expect(filterOf('/exercise/dataPoints:reconcile')).toBe(
      'exercise.interval.civil_start_time >= "2026-08-25" AND exercise.interval.civil_start_time < "2026-08-26"',
    );
    for (const call of calls) expect(call.url).not.toContain('Z%22');
  });
});

describe('Google Health sync — response parsing', () => {
  it('reads countSum, kcalSum and minutesAsleep', async () => {
    mockGoogleHealth(healthyDay);
    const r = await fitbitService.syncTodayData('token', '2026-08-25', 'google');

    expect(r.steps.value).toBe(11530);
    expect(r.caloriesOut?.value).toBe(2842);
    expect(r.caloriesBasis).toBe('total');
    expect(r.sleep.value).toBe(7.2);
    expect(r.unavailable).toEqual({});
  });

  it('maps exercise sessions to activities in the user local time', async () => {
    mockGoogleHealth({
      ...healthyDay,
      exercise: {
        dataPoints: [{
          exercise: {
            exerciseType: 'STRENGTH_TRAINING',
            interval: {
              startTime: '2026-08-25T15:05:00Z',
              endTime: '2026-08-25T15:50:00Z',
              startUtcOffset: '-25200s',
            },
            metricsSummary: { caloriesKcal: 331.7, averageHeartRateBeatsPerMinute: '128' },
          },
        }],
      },
    });

    const r = await fitbitService.syncTodayData('token', '2026-08-25', 'google');
    expect(r.activities).toEqual([
      {
        activityName: 'Strength Training',
        startTime: '08:05',
        durationMin: 45,
        calories: 332,
        averageHeartRate: 128,
        // 128 bpm average → steady state under classifyActivityTier's HR rules
        activityTier: 'tier2_steady_state',
      },
    ]);
  });
});

describe('Google Health sync — calorie burn', () => {
  it('sums active + basal when the device publishes no total-calories', async () => {
    mockGoogleHealth({
      steps: steps('11530'),
      'active-energy-burned': activeEnergy(1240),
      'basal-energy-burned': basalEnergy(900, 960),
      sleep: sleep('432'),
    });

    const r = await fitbitService.syncTodayData('token', '2026-08-25', 'google');
    expect(r.caloriesOut?.value).toBe(3100);
    expect(r.caloriesBasis).toBe('active+basal');
    expect(r.unavailable?.caloriesOut).toBeUndefined();
  });

  it('prefers active + basal when the reported total is below the day basal burn', async () => {
    mockGoogleHealth({
      steps: steps('11530'),
      'total-calories': totalCalories(1900),
      'active-energy-burned': activeEnergy(1240),
      'basal-energy-burned': basalEnergy(1860),
      sleep: sleep('432'),
    });

    const r = await fitbitService.syncTodayData('token', '2026-08-25', 'google');
    expect(r.caloriesOut?.value).toBe(3100);
    expect(r.caloriesBasis).toBe('active+basal');
  });

  it('flags an activity-only reading so the caller knows the basal half is missing', async () => {
    mockGoogleHealth({
      steps: steps('11530'),
      'active-energy-burned': activeEnergy(820),
      sleep: sleep('432'),
    });

    const r = await fitbitService.syncTodayData('token', '2026-08-25', 'google');
    expect(r.caloriesOut?.value).toBe(820);
    expect(r.caloriesBasis).toBe('active-only');
  });

  it('marks calories unavailable when no energy data type has anything', async () => {
    mockGoogleHealth({ steps: steps('11530'), sleep: sleep('432') });

    const r = await fitbitService.syncTodayData('token', '2026-08-25', 'google');
    expect(r.caloriesOut).toBeUndefined();
    expect(r.caloriesBasis).toBeUndefined();
    expect(r.unavailable?.caloriesOut).toBe(true);
  });
});

describe('Google Health sync — missing data is never reported as zero', () => {
  it('marks steps unavailable when no rollup bucket exists for the day', async () => {
    mockGoogleHealth({ 'total-calories': totalCalories(2400), sleep: sleep('400') });

    const r = await fitbitService.syncTodayData('token', '2026-08-25', 'google');
    expect(r.steps.value).toBe(0);
    expect(r.unavailable?.steps).toBe(true);
  });

  it('falls back to the raw steps stream when the rollup bucket is missing', async () => {
    const calls = mockGoogleHealth({
      steps: { rollupDataPoints: [], dataPoints: [{ steps: { count: '3000' } }, { steps: { count: '2500' } }] },
      'total-calories': totalCalories(2400),
      sleep: sleep('400'),
    });

    const r = await fitbitService.syncTodayData('token', '2026-08-25', 'google');
    expect(r.steps.value).toBe(5500);
    expect(r.unavailable?.steps).toBeUndefined();
    expect(calls.some((c) => c.url.includes('/steps/dataPoints:reconcile'))).toBe(true);
  });

  it('marks sleep unavailable when the day has no sleep session', async () => {
    mockGoogleHealth({ steps: steps('8000'), 'total-calories': totalCalories(2400) });

    const r = await fitbitService.syncTodayData('token', '2026-08-25', 'google');
    expect(r.sleep.value).toBe(0);
    expect(r.unavailable?.sleep).toBe(true);
  });

  it('throws instead of returning an all-zero success when every read fails', async () => {
    const fail = { status: 400, body: { error: { message: 'bad request' } } };
    mockGoogleHealth({
      steps: fail,
      'total-calories': fail,
      'active-energy-burned': fail,
      'basal-energy-burned': fail,
      sleep: fail,
      exercise: fail,
    });

    await expect(fitbitService.syncTodayData('token', '2026-08-25', 'google')).rejects.toMatchObject({
      status: 400,
    });
  });
});

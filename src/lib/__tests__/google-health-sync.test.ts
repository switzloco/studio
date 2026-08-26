import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fitbitService } from '../fitbit-service';

vi.mock('firebase/firestore', () => ({}));

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown };

/** Route a fetch by endpoint + data type, so tests only state what they care about. */
function mockFetch(routes: Record<string, Handler>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    const res = key ? routes[key](url, init) : { status: 404, body: { error: 'no route' } };
    const status = res.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => res.body,
      text: async () => JSON.stringify(res.body),
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

const stepsRollup = (count: string) => ({
  rollupDataPoints: [
    { civilStartTime: { date: { year: 2026, month: 8, day: 25 } }, steps: { countSum: count } },
  ],
});

const caloriesRollup = (kcal: number) => ({
  rollupDataPoints: [
    { civilStartTime: { date: { year: 2026, month: 8, day: 25 } }, totalCalories: { kcalSum: kcal } },
  ],
});

const sleepPoints = (minutesAsleep: string) => ({
  dataPoints: [
    {
      sleep: {
        interval: { startTime: '2026-08-24T22:10:00Z', endTime: '2026-08-25T13:40:00Z' },
        summary: { minutesAsleep: minutesAsleep, minutesAwake: '30' },
      },
    },
  ],
});

const fullDay = {
  ':dailyRollUp': (url: string) => ({
    body: url.includes('/total-calories/') ? caloriesRollup(2842) : stepsRollup('11530'),
  }),
  ':reconcile': (url: string) => ({
    body: url.includes('/sleep/') ? sleepPoints('432') : { dataPoints: [] },
  }),
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('Google Health sync — request shape', () => {
  it('sends a civil-date range and an explicit window size to dailyRollUp', async () => {
    const calls = mockFetch(fullDay);
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
    const calls = mockFetch(fullDay);
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
    mockFetch(fullDay);
    const r = await fitbitService.syncTodayData('token', '2026-08-25', 'google');

    expect(r.steps.value).toBe(11530);
    expect(r.caloriesOut?.value).toBe(2842);
    expect(r.sleep.value).toBe(7.2);
    expect(r.unavailable).toEqual({});
  });

  it('maps exercise sessions to activities in the user local time', async () => {
    mockFetch({
      ...fullDay,
      ':reconcile': (url: string) => ({
        body: url.includes('/sleep/')
          ? sleepPoints('432')
          : url.includes('/exercise/')
            ? {
                dataPoints: [
                  {
                    exercise: {
                      exerciseType: 'STRENGTH_TRAINING',
                      interval: {
                        startTime: '2026-08-25T15:05:00Z',
                        endTime: '2026-08-25T15:50:00Z',
                        startUtcOffset: '-25200s',
                      },
                      metricsSummary: { caloriesKcal: 331.7, averageHeartRateBeatsPerMinute: '128' },
                    },
                  },
                ],
              }
            : { dataPoints: [] },
      }),
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

describe('Google Health sync — missing data is never reported as zero', () => {
  it('marks steps unavailable when no rollup bucket exists for the day', async () => {
    mockFetch({
      ':dailyRollUp': (url: string) => ({
        body: url.includes('/total-calories/') ? caloriesRollup(2400) : { rollupDataPoints: [] },
      }),
      ':reconcile': (url: string) => ({
        body: url.includes('/sleep/') ? sleepPoints('400') : { dataPoints: [] },
      }),
    });

    const r = await fitbitService.syncTodayData('token', '2026-08-25', 'google');
    expect(r.steps.value).toBe(0);
    expect(r.unavailable?.steps).toBe(true);
  });

  it('falls back to the raw steps stream when the rollup bucket is missing', async () => {
    mockFetch({
      ':dailyRollUp': (url: string) => ({
        body: url.includes('/total-calories/') ? caloriesRollup(2400) : { rollupDataPoints: [] },
      }),
      ':reconcile': (url: string) => ({
        body: url.includes('/steps/')
          ? { dataPoints: [{ steps: { count: '3000' } }, { steps: { count: '2500' } }] }
          : url.includes('/sleep/')
            ? sleepPoints('400')
            : { dataPoints: [] },
      }),
    });

    const r = await fitbitService.syncTodayData('token', '2026-08-25', 'google');
    expect(r.steps.value).toBe(5500);
    expect(r.unavailable?.steps).toBeUndefined();
  });

  it('marks sleep unavailable when the day has no sleep session', async () => {
    mockFetch({
      ':dailyRollUp': (url: string) => ({
        body: url.includes('/total-calories/') ? caloriesRollup(2400) : stepsRollup('8000'),
      }),
      ':reconcile': () => ({ body: { dataPoints: [] } }),
    });

    const r = await fitbitService.syncTodayData('token', '2026-08-25', 'google');
    expect(r.sleep.value).toBe(0);
    expect(r.unavailable?.sleep).toBe(true);
  });

  it('throws instead of returning an all-zero success when every read fails', async () => {
    mockFetch({
      ':dailyRollUp': () => ({ status: 400, body: { error: { message: 'bad request' } } }),
      ':reconcile': () => ({ status: 400, body: { error: { message: 'bad request' } } }),
    });

    await expect(fitbitService.syncTodayData('token', '2026-08-25', 'google')).rejects.toMatchObject({
      status: 400,
    });
  });
});

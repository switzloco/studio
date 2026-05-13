import { describe, it, expect } from 'vitest';
import { addDaysIso, alignSeriesByDate, correlation, pearson, MIN_N_FOR_CORRELATION } from '../correlation';

describe('addDaysIso', () => {
  it('adds positive days across month boundary', () => {
    expect(addDaysIso('2026-01-30', 5)).toBe('2026-02-04');
  });
  it('subtracts days across year boundary', () => {
    expect(addDaysIso('2026-01-02', -5)).toBe('2025-12-28');
  });
  it('handles leap-year Feb 29 correctly', () => {
    expect(addDaysIso('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDaysIso('2024-02-29', 1)).toBe('2024-03-01');
  });
  it('is invariant to DST (spring forward — March 9 2025 in US)', () => {
    // If this used local-time math the result could be off by a day depending
    // on the runner's TZ. UTC math keeps it stable.
    expect(addDaysIso('2025-03-08', 1)).toBe('2025-03-09');
    expect(addDaysIso('2025-03-09', 1)).toBe('2025-03-10');
  });
});

describe('pearson', () => {
  it('returns 1 for a perfectly increasing linear relationship', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const ys = xs.map(x => 2 * x + 3);
    expect(pearson(xs, ys)).toBeCloseTo(1, 10);
  });
  it('returns -1 for a perfectly decreasing relationship', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const ys = xs.map(x => -x);
    expect(pearson(xs, ys)).toBeCloseTo(-1, 10);
  });
  it('returns ~0 for uncorrelated data', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const ys = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
    expect(pearson(xs, ys)).toBeCloseTo(0, 10);
  });
  it('matches a known fixture (Pearson textbook)', () => {
    // From Wikipedia's Pearson correlation worked example
    const xs = [1, 2, 3, 5, 8];
    const ys = [0.11, 0.12, 0.13, 0.15, 0.18];
    expect(pearson(xs, ys)).toBeCloseTo(1, 4);
  });
});

describe('correlation()', () => {
  it(`refuses to report when n < ${MIN_N_FOR_CORRELATION}`, () => {
    const r = correlation([1, 2, 3], [1, 2, 3]);
    expect(r.magnitude).toBe('insufficient_data');
    expect(r.pearson).toBeNull();
    expect(r.pValueApprox).toBeNull();
    expect(r.n).toBe(3);
    expect(r.caveat).toContain('at least');
  });
  it('reports a strong correlation with magnitude bucket', () => {
    const xs = Array.from({ length: 12 }, (_, i) => i + 1);
    const ys = xs.map(x => 2 * x + (x % 2 === 0 ? 1 : -1)); // near-linear, tiny jitter
    const r = correlation(xs, ys);
    expect(r.pearson).not.toBeNull();
    expect(Math.abs(r.pearson!)).toBeGreaterThan(0.95);
    expect(r.magnitude).toBe('very_strong');
    expect(r.n).toBe(12);
    expect(r.caveat).toMatch(/correlation, not causation/i);
  });
  it('throws when array lengths differ', () => {
    expect(() => correlation([1, 2, 3], [1, 2])).toThrow();
  });
});

describe('alignSeriesByDate', () => {
  it('pairs same-date entries', () => {
    const a = [
      { date: '2026-05-01', value: 10 },
      { date: '2026-05-02', value: 20 },
      { date: '2026-05-03', value: 30 },
    ];
    const b = [
      { date: '2026-05-01', value: 1 },
      { date: '2026-05-02', value: 2 },
      { date: '2026-05-04', value: 4 }, // unpaired
    ];
    const out = alignSeriesByDate(a, b);
    expect(out.n).toBe(2);
    expect(out.dates).toEqual(['2026-05-01', '2026-05-02']);
    expect(out.xs).toEqual([10, 20]);
    expect(out.ys).toEqual([1, 2]);
  });
  it('sums multiple same-day entries within each series', () => {
    const a = [
      { date: '2026-05-01', value: 10 },
      { date: '2026-05-01', value: 5 }, // same day — should be summed
      { date: '2026-05-02', value: 20 },
    ];
    const b = [
      { date: '2026-05-01', value: 1 },
      { date: '2026-05-02', value: 2 },
    ];
    const out = alignSeriesByDate(a, b);
    expect(out.xs).toEqual([15, 20]);
    expect(out.ys).toEqual([1, 2]);
  });
  it('applies positive lag so seriesA precedes seriesB', () => {
    // sleep (a) on May 1 should pair with shooting (b) on May 2
    const sleep = [
      { date: '2026-05-01', value: 8 },
      { date: '2026-05-02', value: 6 },
    ];
    const shooting = [
      { date: '2026-05-02', value: 0.55 },
      { date: '2026-05-03', value: 0.40 },
    ];
    const out = alignSeriesByDate(sleep, shooting, 1);
    expect(out.n).toBe(2);
    expect(out.dates).toEqual(['2026-05-02', '2026-05-03']);
    expect(out.xs).toEqual([8, 6]);
    expect(out.ys).toEqual([0.55, 0.40]);
  });
  it('returns empty when no dates overlap', () => {
    const a = [{ date: '2026-05-01', value: 1 }];
    const b = [{ date: '2026-06-01', value: 1 }];
    expect(alignSeriesByDate(a, b).n).toBe(0);
  });
});

/**
 * @fileOverview Pure-function helpers for correlation analysis used by the
 * Data Analyst Genkit flow. Kept out of any `'use server'` file so tests can
 * import them and so the build doesn't reject non-async-function exports.
 */

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function addDaysIso(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d + deltaDays);
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export type CorrelationMagnitude =
  | 'negligible'
  | 'weak'
  | 'moderate'
  | 'strong'
  | 'very_strong'
  | 'insufficient_data';

export interface CorrelationResult {
  n: number;
  pearson: number | null;
  pValueApprox: number | null;
  magnitude: CorrelationMagnitude;
  caveat: string;
}

export const MIN_N_FOR_CORRELATION = 10;

export function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n === 0) return 0;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, denomX = 0, denomY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  const denom = Math.sqrt(denomX * denomY);
  return denom === 0 ? 0 : num / denom;
}

// Abramowitz & Stegun 26.2.17 normal CDF approximation — accurate to ~7.5e-8.
export function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * absX);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-absX * absX);
  return 0.5 * (1 + sign * y);
}

export function correlation(xs: number[], ys: number[]): CorrelationResult {
  if (xs.length !== ys.length) {
    throw new Error(`xs and ys must be equal length (got ${xs.length} vs ${ys.length})`);
  }
  const n = xs.length;
  if (n < MIN_N_FOR_CORRELATION) {
    return {
      n,
      pearson: null,
      pValueApprox: null,
      magnitude: 'insufficient_data',
      caveat: `Only ${n} paired observations — need at least ${MIN_N_FOR_CORRELATION} to report a correlation. Encourage the user to keep logging.`,
    };
  }
  const r = pearson(xs, ys);
  let pValueApprox: number;
  if (Math.abs(r) >= 0.999999) {
    pValueApprox = 0;
  } else {
    const t = r * Math.sqrt((n - 2) / (1 - r * r));
    pValueApprox = 2 * (1 - normalCdf(Math.abs(t)));
  }
  const abs = Math.abs(r);
  const magnitude: CorrelationMagnitude =
    abs < 0.1 ? 'negligible' :
    abs < 0.3 ? 'weak' :
    abs < 0.5 ? 'moderate' :
    abs < 0.7 ? 'strong' :
    'very_strong';
  return {
    n,
    pearson: r,
    pValueApprox,
    magnitude,
    caveat: `Correlation, not causation. n=${n}, r=${r.toFixed(2)}, p≈${pValueApprox.toFixed(3)}. Always report n alongside the result.`,
  };
}

export interface AlignedSeries {
  xs: number[];
  ys: number[];
  dates: string[];
  n: number;
}

/**
 * Pairs two date-stamped series into aligned (xs, ys). Same-day values within
 * a series are summed. lagDays shifts seriesA backwards by that many days
 * relative to seriesB (positive lag => seriesA precedes seriesB).
 */
export function alignSeriesByDate(
  seriesA: { date: string; value: number }[],
  seriesB: { date: string; value: number }[],
  lagDays = 0
): AlignedSeries {
  const sumByDate = (series: { date: string; value: number }[]): Map<string, number> => {
    const map = new Map<string, number>();
    for (const { date, value } of series) map.set(date, (map.get(date) ?? 0) + value);
    return map;
  };
  const aMap = sumByDate(seriesA);
  const bMap = sumByDate(seriesB);
  const xs: number[] = [];
  const ys: number[] = [];
  const dates: string[] = [];
  const bDates = [...bMap.keys()].sort();
  for (const bDate of bDates) {
    const aDate = addDaysIso(bDate, -lagDays);
    const aVal = aMap.get(aDate);
    if (aVal === undefined) continue;
    xs.push(aVal);
    ys.push(bMap.get(bDate)!);
    dates.push(bDate);
  }
  return { xs, ys, dates, n: xs.length };
}

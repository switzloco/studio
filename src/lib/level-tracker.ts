/**
 * @fileOverview Flexible Level / Sprint Tracker & Historical Google Sheet Bridge.
 *
 * Replaces the right-hand Level summary blocks from the user's Google Sheet:
 *   - Total Points (in current level)
 *   - Points per Day (overall level pace + 7-day rolling pace)
 *   - Target Points
 *   - Points to Target
 *   - Days to Target at current pace
 *   - Projected Finish Date (Fin Date)
 *   - Required Points/Day (when an optional targetDate is set)
 */

import type { HistoryEntry } from './health-service';

export type LevelStatus = 'active' | 'completed' | 'retry';

export interface LevelConfig {
  id: string;
  name: string;
  startDate: string;          // YYYY-MM-DD
  endDate?: string;           // YYYY-MM-DD (set when completed/archived)
  targetPoints: number;       // e.g. 500, 1000, 2000, 3000
  targetDate?: string;        // Optional YYYY-MM-DD deadline for "Required pts/day"
  status: LevelStatus;
  /** Optional point offset carried into the level (default 0). */
  startingPointsOffset?: number;
  /** Optional scoring engine vintage label for historical context. */
  engineEra?: string;
  /** Snapshot total points for archived levels imported from the spreadsheet. */
  snapshotTotalPoints?: number;
  /** Snapshot days elapsed for archived levels imported from the spreadsheet. */
  snapshotDays?: number;
  notes?: string;
}

export interface LevelProgress {
  level: LevelConfig;
  totalPoints: number;
  daysScored: number;
  pointsPerDay: number;
  rolling7dPointsPerDay: number;
  targetPoints: number;
  /** targetPoints - totalPoints (negative once target is beaten, matching sheet). */
  pointsToTarget: number;
  /** Days remaining at current pointsPerDay pace, or null if pace <= 0 and still below target. */
  daysToTarget: number | null;
  /** YYYY-MM-DD projected completion date, or null if pace <= 0 and below target. */
  projectedFinishDate: string | null;
  /** Required pts/day to hit targetDate (if targetDate is configured), else null. */
  requiredPointsPerDay: number | null;
  /** 0 to 100+ completion percentage. */
  progressPct: number;
  isTargetMet: boolean;
}

/**
 * Pre-seeded 2026 Level History from the user's Google Sheet so their past
 * blocks are immediately preserved inside the app.
 */
export const DEFAULT_LEVEL_HISTORY: LevelConfig[] = [
  {
    id: 'level-1-2026',
    name: 'Level 1 (Initial)',
    startDate: '2026-01-11',
    endDate: '2026-03-18',
    targetPoints: 3000,
    status: 'completed',
    engineEra: 'v1.0 Drago–Moore',
    snapshotTotalPoints: 3287,
    snapshotDays: 66,
    notes: 'Original linear deficit system + 36h fasts',
  },
  {
    id: 'level-2-2026',
    name: 'Level 2',
    startDate: '2026-03-19',
    endDate: '2026-06-02',
    targetPoints: 3000,
    status: 'completed',
    engineEra: 'v2.0 GSP–Gilfoyle',
    snapshotTotalPoints: 3277,
    snapshotDays: 80,
    notes: 'Switched to Alpert-normalized v2 system on 3/19 (41.0 pts/day)',
  },
  {
    id: 'level-2-retry-2026',
    name: 'Level 2 - Retry',
    startDate: '2026-06-03',
    endDate: '2026-07-19',
    targetPoints: 1000,
    status: 'completed',
    engineEra: 'v3.0 Balboa–Hopper',
    snapshotTotalPoints: 1076,
    snapshotDays: 48,
    notes: 'Summer maintenance & 1,000-pt lock-in block (22.4 pts/day)',
  },
  {
    id: 'level-3-2026',
    name: 'Level 3 (Summer)',
    startDate: '2026-07-20',
    endDate: '2026-09-21',
    targetPoints: 2000,
    status: 'completed',
    engineEra: 'v3.1 Bull–Lovelace',
    snapshotTotalPoints: 1901,
    snapshotDays: 64,
    notes: 'v3.1 alcohol clearance engine; reached 1,901 / 2,000 pts',
  },
];

export const DEFAULT_ACTIVE_LEVEL: LevelConfig = {
  id: 'level-3-thanksgiving-2026',
  name: 'Level 3 (Thanksgiving 500)',
  startDate: '2026-09-22',
  targetPoints: 500,
  targetDate: '2026-11-26',
  status: 'active',
  engineEra: 'v3.2 Taylor–Joule',
  notes: '500 points by Thanksgiving (started Sep 22)',
};

/**
 * Resolves the user's active level, automatically upgrading the old Oct 18 placeholder
 * default to the user's Sep 22 -> Thanksgiving 500-pt Level 3 sprint.
 */
export function resolveActiveLevel(saved?: LevelConfig | null): LevelConfig {
  if (!saved) return DEFAULT_ACTIVE_LEVEL;
  if (saved.id === 'level-3-lock-in-2026' && saved.startDate === '2026-10-18' && saved.targetPoints === 1000) {
    return DEFAULT_ACTIVE_LEVEL;
  }
  return saved;
}

/**
 * Handwritten notes imported from the user's 2026 Google Sheet (Jan 11 – Oct 17).
 * Used as a zero-config fallback when a HistoryEntry does not have a custom `dayNote` saved yet.
 */
export const SHEET_DAY_NOTES: Record<string, string> = {
  '2026-01-16': 'Date',
  '2026-01-17': 'Wine',
  '2026-01-19': 'Holiday Wine',
  '2026-01-23': 'Date Night',
  '2026-01-24': 'Seltzers, probably too many',
  '2026-01-28': 'Dad visit + sushi & sake',
  '2026-01-29': 'Concert wine',
  '2026-01-30': 'Date night walking',
  '2026-02-03': 'Disc golf beers',
  '2026-02-11': 'High burn day but some wine finish',
  '2026-02-14': 'Wine and demolition burgers',
  '2026-02-15': 'back injury',
  '2026-02-16': 'Monday trip to Twain Hart',
  '2026-02-23': '**Realized that 5.5 oz is NOT a max burn day so using 10 oz as MAX again',
  '2026-02-26': 'Brownie, Bagel, protein was too late, bball',
  '2026-03-04': '36 Hour Fast with frisbee!',
  '2026-03-19': '**** New System started',
  '2026-04-11': 'drinks',
  '2026-04-12': 'crazy long Day with hoops and walking but drinks at',
  '2026-05-01': 'lots of drinks, gio bday',
  '2026-05-05': 'Cinco de Mayo drinks took it down after bball',
  '2026-05-13': 'bike to work day + hoops',
  '2026-05-28': 'Really > 120 because of calorie deficit but late night drinks I knocked off points',
  '2026-05-31': 'Really > 120 because of calorie deficit but late night drinks I knocked off points',
  '2026-06-01': 'no booze but low move',
  '2026-06-02': 'No booze and hoops great day',
  '2026-06-03': 'Boozy, wonder if the CFO was working strictly',
  '2026-06-09': '1 glass wine, walking and Indian food',
  '2026-06-10': 'Half margarita',
  '2026-06-14': 'Dta',
  '2026-07-20': '***Another new system, slightly less aggressive against booze',
  '2026-07-24': "This one is the most perplexing, I don't think I had that bad of a day?",
  '2026-07-25': 'deficit but alcohol penalty',
  '2026-08-29': '34 hour fast',
  '2026-08-30': 'BBall',
  '2026-08-31': 'PSMF',
  '2026-09-01': 'IF plus bball',
  '2026-09-02': 'recovery day + wine',
  '2026-09-08': '20hr + PSMF',
  '2026-09-28': '19 hr fast, mostly psmf, 3 oz fries DRY NIGHT - this algo is HARD',
  '2026-10-01': '19 hr fast, bball, some drinks',
};

export function getEffectiveDayNote(entry?: { isoDate?: string; dayNote?: string } | null): string | undefined {
  if (!entry) return undefined;
  if (entry.dayNote !== undefined) {
    return entry.dayNote.trim() || undefined;
  }
  if (entry.isoDate && SHEET_DAY_NOTES[entry.isoDate]) {
    return SHEET_DAY_NOTES[entry.isoDate];
  }
  return undefined;
}

function addDaysIso(baseIso: string, daysToAdd: number): string {
  const [y, m, d] = baseIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + Math.round(daysToAdd));
  return dt.toISOString().split('T')[0];
}

function diffDaysIso(fromIso: string, toIso: string): number {
  const [y1, m1, d1] = fromIso.split('-').map(Number);
  const [y2, m2, d2] = toIso.split('-').map(Number);
  const t1 = Date.UTC(y1, (m1 || 1) - 1, d1 || 1);
  const t2 = Date.UTC(y2, (m2 || 1) - 1, d2 || 1);
  return Math.round((t2 - t1) / (1000 * 60 * 60 * 24));
}

export interface ComputeLevelOptions {
  /** Live score for today (included when today is not yet in `history`). */
  todayGain?: number | null;
  /** Current local YYYY-MM-DD (defaults to today). */
  todayIso?: string;
}

/**
 * Computes Google-Sheet-equivalent Level metrics (`Total Points`, `Points per Day`,
 * `Points to Target`, `Days to Target`, `Fin Date`, `Required pts/day`).
 */
export function computeLevelProgress(
  level: LevelConfig,
  history: HistoryEntry[] = [],
  options: ComputeLevelOptions = {},
): LevelProgress {
  const todayIso = options.todayIso ?? new Date().toISOString().split('T')[0];
  const upperBound = level.endDate ?? '9999-12-31';

  // Deduplicate matching history entries by isoDate (later entry wins)
  const byDate = new Map<string, number>();
  for (const h of history) {
    if (!h.isoDate || h.detail === 'Account Created') continue;
    if (h.isoDate >= level.startDate && h.isoDate <= upperBound) {
      byDate.set(h.isoDate, h.gain);
    }
  }

  // Include live todayGain if today is inside the level window and not yet in history
  if (
    options.todayGain != null &&
    todayIso >= level.startDate &&
    todayIso <= upperBound &&
    !byDate.has(todayIso)
  ) {
    byDate.set(todayIso, options.todayGain);
  }

  const sortedDates = Array.from(byDate.keys()).sort();
  const useSnapshot =
    level.status !== 'active' &&
    level.snapshotTotalPoints !== undefined &&
    sortedDates.length === 0;

  const offset = level.startingPointsOffset ?? 0;
  const rawSum = sortedDates.reduce((acc, d) => acc + (byDate.get(d) ?? 0), 0);
  const totalPoints = useSnapshot
    ? level.snapshotTotalPoints!
    : Math.round((rawSum + offset) * 10) / 10;

  const daysScored = useSnapshot
    ? Math.max(1, level.snapshotDays ?? 1)
    : sortedDates.length;

  const pointsPerDay =
    daysScored > 0 ? Math.round((totalPoints / daysScored) * 10) / 10 : 0;

  // Rolling 7-day pace from the most recent up to 7 scored days in the level
  const recentDates = sortedDates.slice(-7);
  const recentSum = recentDates.reduce((acc, d) => acc + (byDate.get(d) ?? 0), 0);
  const rolling7dPointsPerDay =
    recentDates.length > 0
      ? Math.round((recentSum / recentDates.length) * 10) / 10
      : pointsPerDay;

  const targetPoints = level.targetPoints;
  const pointsToTarget = Math.round((targetPoints - totalPoints) * 10) / 10;
  const isTargetMet = totalPoints >= targetPoints;

  let daysToTarget: number | null = null;
  let projectedFinishDate: string | null = null;

  const referenceDate =
    level.endDate ??
    (sortedDates.length > 0 && sortedDates[sortedDates.length - 1] > todayIso
      ? sortedDates[sortedDates.length - 1]
      : todayIso);

  if (pointsPerDay > 0) {
    daysToTarget = Math.round((pointsToTarget / pointsPerDay) * 10) / 10;
    projectedFinishDate = addDaysIso(referenceDate, Math.ceil(daysToTarget));
  } else if (isTargetMet) {
    daysToTarget = 0;
    projectedFinishDate = referenceDate;
  }

  let requiredPointsPerDay: number | null = null;
  if (level.targetDate && pointsToTarget > 0) {
    const daysLeft = diffDaysIso(todayIso, level.targetDate);
    if (daysLeft > 0) {
      requiredPointsPerDay = Math.round((pointsToTarget / daysLeft) * 10) / 10;
    }
  }

  const progressPct =
    targetPoints > 0
      ? Math.max(0, Math.round((totalPoints / targetPoints) * 100))
      : 0;

  return {
    level,
    totalPoints,
    daysScored,
    pointsPerDay,
    rolling7dPointsPerDay,
    targetPoints,
    pointsToTarget,
    daysToTarget,
    projectedFinishDate,
    requiredPointsPerDay,
    progressPct,
    isTargetMet,
  };
}

export interface DailyLevelPointEntry {
  isoDate: string;
  dailyScore: number;
  /** Running cumulative points inside this date's Level (resets at each Level startDate). */
  levelPoints: number;
  levelId: string;
  levelName: string;
  shortLabel: string;
  targetPoints: number;
  isInActiveLevel: boolean;
}

function getShortLevelLabel(name: string): string {
  const m = name.match(/Level\s*(\d+)/i);
  if (m) {
    if (/retry/i.test(name)) return `L${m[1]}R`;
    if (/thanksgiving|lock-in/i.test(name)) return `L${m[1]}`;
    return `L${m[1]}`;
  }
  return 'LVL';
}

/**
 * Computes day-by-day Level Tracking cumulative points (`levelPoints`) for every date
 * in `history`, matching each day to either `activeLevel` (when >= activeLevel.startDate)
 * or its historical level from `levelHistory`.
 */
export function computeDailyLevelPointsMap(
  history: HistoryEntry[] = [],
  activeLevel: LevelConfig = DEFAULT_ACTIVE_LEVEL,
  levelHistory: LevelConfig[] = DEFAULT_LEVEL_HISTORY,
): Map<string, DailyLevelPointEntry> {
  const result = new Map<string, DailyLevelPointEntry>();

  // Deduplicate history by isoDate (chronological order)
  const byDate = new Map<string, HistoryEntry>();
  for (const h of history) {
    if (h.detail === 'Account Created') continue;
    const key = h.isoDate || h.date;
    if (key) byDate.set(key, h);
  }

  const sortedDates = Array.from(byDate.keys()).sort();
  const activeUpper = activeLevel.endDate ?? '9999-12-31';

  // Track running sum per levelId
  const runningByLevel = new Map<string, number>();

  for (const dateKey of sortedDates) {
    const entry = byDate.get(dateKey)!;
    const isInActive =
      dateKey >= activeLevel.startDate && dateKey <= activeUpper;

    let matchedLevel: LevelConfig | undefined;
    if (isInActive) {
      matchedLevel = activeLevel;
    } else {
      // Find matching historical level whose window covers dateKey
      for (let i = levelHistory.length - 1; i >= 0; i--) {
        const lvl = levelHistory[i];
        const end = lvl.endDate ?? '9999-12-31';
        if (dateKey >= lvl.startDate && dateKey <= end) {
          matchedLevel = lvl;
          break;
        }
      }
    }

    const lvlId = matchedLevel?.id ?? 'unassigned-level';
    const lvlName = matchedLevel?.name ?? 'Level';
    const lvlTarget = matchedLevel?.targetPoints ?? activeLevel.targetPoints;
    const startOffset = matchedLevel?.startingPointsOffset ?? 0;

    const prevRunning = runningByLevel.has(lvlId)
      ? runningByLevel.get(lvlId)!
      : startOffset;
    const nextRunning = Math.round((prevRunning + entry.gain) * 10) / 10;
    runningByLevel.set(lvlId, nextRunning);

    result.set(dateKey, {
      isoDate: dateKey,
      dailyScore: entry.gain,
      levelPoints: nextRunning,
      levelId: lvlId,
      levelName: lvlName,
      shortLabel: getShortLevelLabel(lvlName),
      targetPoints: lvlTarget,
      isInActiveLevel: isInActive,
    });
  }

  return result;
}

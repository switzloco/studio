/**
 * @fileOverview Merge rules for per-day device snapshots.
 *
 * A snapshot write replaces the whole `fitbitByDate.{date}` map entry, so any
 * sync that came back empty — a failed API call, a day the provider has no
 * data for — would otherwise erase real history by writing zeroes over it.
 * Every snapshot write goes through {@link mergeDailySnapshot}, where
 * "unknown" always loses to "known".
 */
import type { FitbitDailySnapshot, HealthMetricAvailability } from './health-service';

/** Does this snapshot carry any real device measurement? */
export function snapshotHasData(snap: FitbitDailySnapshot | undefined): boolean {
  if (!snap) return false;
  return (
    (snap.steps ?? 0) > 0 ||
    (snap.sleepHours ?? 0) > 0 ||
    (snap.caloriesOut ?? 0) > 0 ||
    (snap.hrv ?? 0) > 0 ||
    (snap.activities?.length ?? 0) > 0
  );
}

/**
 * Combine a freshly-synced snapshot with what is already stored for that day.
 *
 * Rules, per field:
 *  • marked unavailable → the incoming value is unknown, keep the stored one;
 *  • incoming 0 / empty → keep the stored one (a device reporting nothing is
 *    not evidence that the day was zero);
 *  • steps → keep the larger value. Steps only accumulate within a day, and a
 *    provider that reports fewer than we already recorded (e.g. Google Health
 *    backfilling a day Fitbit had already reported in full) is regressing.
 *
 * Returns null when the merge would change nothing — the caller can skip the
 * write entirely.
 */
export function mergeDailySnapshot(
  existing: FitbitDailySnapshot | undefined,
  incoming: FitbitDailySnapshot,
  unavailable: HealthMetricAvailability = {},
): FitbitDailySnapshot | null {
  const merged: FitbitDailySnapshot = { ...(existing ?? {}) };
  let changed = false;

  const set = <K extends keyof FitbitDailySnapshot>(key: K, value: FitbitDailySnapshot[K]) => {
    if (merged[key] === value) return;
    merged[key] = value;
    changed = true;
  };

  const incomingSteps = incoming.steps ?? 0;
  const existingSteps = existing?.steps ?? 0;
  if (!unavailable.steps && incomingSteps > existingSteps) set('steps', incomingSteps);

  if (!unavailable.sleep && (incoming.sleepHours ?? 0) > 0) {
    set('sleepHours', incoming.sleepHours);
    if (incoming.recoveryStatus) set('recoveryStatus', incoming.recoveryStatus);
  }

  if (!unavailable.caloriesOut && (incoming.caloriesOut ?? 0) > 0) {
    set('caloriesOut', incoming.caloriesOut);
  }

  if ((incoming.hrv ?? 0) > 0) {
    set('hrv', incoming.hrv);
    if (incoming.recoveryStatus) set('recoveryStatus', incoming.recoveryStatus);
  }

  if (!unavailable.activities && incoming.activities && incoming.activities.length > 0) {
    set('activities', incoming.activities);
  }

  // Only claim the day was captured now if we actually recorded something for
  // it — otherwise a no-data sync would mark a partial day as final.
  if (changed && incoming.capturedOnDate) set('capturedOnDate', incoming.capturedOnDate);

  return changed ? merged : null;
}

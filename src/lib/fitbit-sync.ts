import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService } from '@/lib/health-service-admin';
import { fitbitService, FitbitApiError } from '@/lib/fitbit-service';
import { calculateDailyVFScore } from './vf-scoring';
import type { HistoryEntry } from './health-service';
import { mergeDailySnapshot } from './health-snapshot';

/** How often (ms) background sync should run — 6 hours. */
export const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Estimate resting BMR from the user's stored profile using Mifflin-St Jeor.
 * Used only when the provider published activity burn with no basal half to go
 * with it (`caloriesBasis: 'active-only'`) — never to top up a figure that is
 * already a full-day total.
 * Falls back to 1600 kcal — a reasonable adult average — if no weight is set.
 */
async function estimateBmrFromProfile(firestore: import('firebase-admin/firestore').Firestore, userId: string): Promise<number> {
  try {
    const health = await adminHealthService.getHealthSummary(firestore, userId);
    const weightKg = health?.weightKg;
    const heightCm = health?.heightCm;
    if (!weightKg) return 1600;
    // Mifflin-St Jeor (male formula — sex isn't stored, this approximates).
    // BMR = 10*kg + 6.25*cm − 5*age + 5. Without age, use 40.
    const h = heightCm ?? 175;
    return Math.round(10 * weightKg + 6.25 * h - 5 * 40 + 5);
  } catch (err) {
    console.warn('[estimateBmrFromProfile] Failed to load profile, using default 1600:', err);
    return 1600;
  }
}

/**
 * Syncs today's Fitbit data for a verified user.
 * Refreshes the access token if needed, fetches steps/sleep/HRV,
 * and writes the updated metrics back to Firestore.
 *
 * Uses Admin SDK — has no client auth context.
 */
export type SyncResult =
  | { success: true }
  | { success: false; 
      reason: 'no_credentials' | 'token_refresh_failed' | 'api_failed' | 'write_failed';
      details?: { httpStatus?: number; endpoint?: string; body?: string; message?: string } };

function getErrorDetails(err: any) {
  if (err instanceof FitbitApiError) {
    return {
      httpStatus: err.status,
      endpoint: err.endpoint,
      message: err.message,
      body: err.body?.slice(0, 500)
    };
  }
  return { message: String(err?.message ?? err) };
}

export async function syncFitbitData(userId: string, localDate?: string, timezoneOffset?: number): Promise<SyncResult> {
  const firestore = getAdminFirestore();

  const creds = await adminHealthService.getFitbitCredentials(firestore, userId);
  if (!creds) return { success: false, reason: 'no_credentials' };
  const provider = creds.provider || 'fitbit';
  
  // Use provided offset, or fall back to stored one
  const finalOffset = timezoneOffset !== undefined ? timezoneOffset : creds.timezoneOffset;

  // Refresh token if within 5 minutes of expiry.
  let accessToken = creds.accessToken;
  // Track the latest credentials so the final lastSyncedAt stamp doesn't need a re-fetch.
  let latestCreds = creds;
  const fiveMinutes = 5 * 60 * 1000;
  if (Date.now() + fiveMinutes >= creds.expiresAt) {
    let refreshed;
    try {
      refreshed = await fitbitService.refreshAccessToken(creds.refreshToken, provider);
    } catch (error) {
      console.error('[syncFitbitData] Token refresh threw an unexpected error:', error);
      // Double check if another process refreshed it (e.g. concurrent request or cron)
      const freshCreds = await adminHealthService.getFitbitCredentials(firestore, userId);
      if (freshCreds && freshCreds.expiresAt > Date.now() + fiveMinutes) {
        console.log('[syncFitbitData] Token refresh failed but found newer valid credentials in Firestore.');
        latestCreds = freshCreds;
        accessToken = freshCreds.accessToken;
      } else {
        return { success: false, reason: 'token_refresh_failed' };
      }
    }
    if (!refreshed && !accessToken) {
      console.error('[syncFitbitData] Token refresh returned null — token may be revoked. Reconnect Fitbit.');
      // Double check if another process refreshed it
      const freshCreds = await adminHealthService.getFitbitCredentials(firestore, userId);
      if (freshCreds && freshCreds.expiresAt > Date.now() + fiveMinutes) {
        console.log('[syncFitbitData] Token refresh returned null but found newer valid credentials in Firestore.');
        latestCreds = freshCreds;
        accessToken = freshCreds.accessToken;
      } else {
        return { success: false, reason: 'token_refresh_failed' };
      }
    } else if (refreshed) {
      latestCreds = { 
        ...refreshed, 
        fitbitUserId: creds.fitbitUserId, 
        lastSyncedAt: creds.lastSyncedAt, 
        provider,
        timezoneOffset: finalOffset 
      };
      await adminHealthService.saveFitbitCredentials(firestore, userId, latestCreds);
      accessToken = refreshed.accessToken;
      console.log(`[syncFitbitData] Token refreshed successfully for user ${userId}.`);
    }
  }

  let result;
  try {
    console.log(`[syncFitbitData] Fetching data for user ${userId} (Provider: ${provider})...`);
    result = await fitbitService.syncTodayData(accessToken, localDate, provider, finalOffset);
  } catch (error: any) {
    if (error?.status === 401) {
      console.warn(`[syncFitbitData] 401 Unauthorized for user ${userId}. Attempting immediate refresh...`);
      let refreshed;
      try {
        refreshed = await fitbitService.refreshAccessToken(latestCreds.refreshToken, provider);
      } catch (refreshErr) {
        console.error(`[syncFitbitData] Token refresh failed for user ${userId} after 401:`, refreshErr);
        // Double check fallback
        const freshCreds = await adminHealthService.getFitbitCredentials(firestore, userId);
        if (freshCreds && freshCreds.expiresAt > Date.now() + fiveMinutes) {
          console.log('[syncFitbitData] Token refresh failed after 401 but found newer valid credentials in Firestore.');
          latestCreds = freshCreds;
          accessToken = freshCreds.accessToken;
        } else {
          return { success: false, reason: 'token_refresh_failed' };
        }
      }
      if (!refreshed && !accessToken) {
        console.error(`[syncFitbitData] Token refresh returned null for user ${userId} after 401.`);
        // Double check fallback
        const freshCreds = await adminHealthService.getFitbitCredentials(firestore, userId);
        if (freshCreds && freshCreds.expiresAt > Date.now() + fiveMinutes) {
          console.log('[syncFitbitData] Token refresh returned null after 401 but found newer valid credentials in Firestore.');
          latestCreds = freshCreds;
          accessToken = freshCreds.accessToken;
        } else {
          return { success: false, reason: 'token_refresh_failed' };
        }
      } else if (refreshed) {
        latestCreds = { 
          ...refreshed, 
          fitbitUserId: latestCreds.fitbitUserId, 
          lastSyncedAt: latestCreds.lastSyncedAt, 
          provider,
          timezoneOffset: finalOffset 
        };
        await adminHealthService.saveFitbitCredentials(firestore, userId, latestCreds);
        accessToken = refreshed.accessToken;
        console.log(`[syncFitbitData] Token refreshed after 401. Retrying sync for user ${userId}...`);
      }
      
      try {
        result = await fitbitService.syncTodayData(accessToken, localDate, provider, finalOffset);
      } catch (retryErr) {
        console.error(`[syncFitbitData] Retry after 401 failed for user ${userId}:`, retryErr);
        const details = getErrorDetails(retryErr);
        return { success: false, reason: 'api_failed', details };
      }
    } else {
      console.error(`[syncFitbitData] Fitbit API call failed for user ${userId}:`, error);
      const details = getErrorDetails(error);
      return { success: false, reason: 'api_failed', details };
    }
  }
  if (!result.success) {
    console.error(`[syncFitbitData] Sync failed for user ${userId}: result.success is false`);
    return { success: false, reason: 'api_failed' };
  }

  // Build update, deriving recoveryStatus from HRV (same logic as the OAuth callback).
  // Always set lastActiveDate so the dashboard's isNewDay check doesn't reset Fitbit-sourced metrics.
  // Calculate local date using the timezone offset if not explicitly provided.
  // getTimezoneOffset() returns minutes to ADD to local time to get UTC, so we subtract to go from UTC back to local.
  const now = new Date();
  const localTime = new Date(now.getTime() - ((finalOffset || 0) * 60000));
  const today = localDate || localTime.toISOString().split('T')[0];

  // Metrics the provider had no trustworthy value for this sync. Their zeroes
  // are "unknown", not "none" — never let them overwrite stored data.
  const unavailable = result.unavailable ?? {};
  const existingHealth = await adminHealthService.getHealthSummary(firestore, userId);

  // Build the daily snapshot for historical lookups (steps/HRV visible on past days).
  // `today` is the local date this snapshot represents AND the date it was captured
  // on — this is a live same-day sync, so caloriesOut is inherently partial until
  // the day is finalised on a later sync (see refreshStalePastSnapshots).
  const incomingSnapshot: import('./health-service').FitbitDailySnapshot = {
    steps: result.steps.value,
    sleepHours: result.sleep.value,
    capturedOnDate: today,
  };

  if (result.caloriesOut && result.caloriesOut.value > 0) {
    // Fitbit TDEE estimates run ~10% high — apply a conservative accuracy adjustment.
    // Google Health data (including Samsung Health via Health Connect) is already accurate.
    const calorieDiscount = provider === 'google' ? 1.0 : 0.90;
    let calsOut = result.caloriesOut.value * calorieDiscount;
    // Only supplement when the device told us it published activity burn WITHOUT
    // a basal half (some Health Connect sources do). Everything else is already a
    // full-day figure — estimating on top of one inflates it.
    if (result.caloriesBasis === 'active-only') {
      const estimatedBmr = await estimateBmrFromProfile(firestore, userId);
      console.log(`[syncFitbitData] ${provider} reported activity burn only (${Math.round(calsOut)} kcal) — adding estimated BMR ${estimatedBmr}`);
      calsOut += estimatedBmr;
    } else if (provider === 'google' && calsOut < 1200) {
      console.warn(`[syncFitbitData] Google reported a full-day burn of only ${Math.round(calsOut)} kcal for ${today} (basis: ${result.caloriesBasis ?? 'unknown'}) — storing as-is.`);
    }
    incomingSnapshot.caloriesOut = Math.round(calsOut);
  }

  // Only update HRV and recoveryStatus when the device returns a valid reading.
  // A value of 0 means the sensor failed or data is unavailable — ignore it
  // so stale-but-valid data isn't overwritten by a bad reading.
  const hrv = result.hrv.value;
  if (hrv > 0) {
    incomingSnapshot.hrv = hrv;
    incomingSnapshot.recoveryStatus = hrv >= 50 ? 'high' : hrv >= 30 ? 'medium' : 'low';
  } else if (!unavailable.sleep && result.sleep.value > 0) {
    // Google Health exposes no HRV — recovery is derived from sleep instead.
    incomingSnapshot.recoveryStatus =
      result.sleep.value >= 7 ? 'high' : result.sleep.value >= 6 ? 'medium' : 'low';
  }
  if (result.activities && result.activities.length > 0) {
    incomingSnapshot.activities = result.activities;
  }

  // Merge over whatever is already stored for today: an unavailable metric, or
  // one the device reports lower than we already recorded, keeps its old value.
  const existingSnapshot = existingHealth?.fitbitByDate?.[today];
  const mergedSnapshot = mergeDailySnapshot(existingSnapshot, incomingSnapshot, unavailable);
  const dayTotals = mergedSnapshot ?? existingSnapshot;

  // The top-level health doc mirrors today's snapshot, so it never regresses
  // either. A metric with no stored value yet is still written when the device
  // actually reported it — a genuine 0 early in the day is real data; only an
  // *unavailable* metric is withheld.
  const pick = (stored: number | undefined, fresh: number, isUnavailable?: boolean) =>
    stored ?? (isUnavailable ? undefined : fresh);

  const healthUpdate: Record<string, unknown> = { lastActiveDate: today };
  const steps = pick(dayTotals?.steps, result.steps.value, unavailable.steps);
  if (steps != null) healthUpdate.steps = steps;
  const sleepHours = pick(dayTotals?.sleepHours, result.sleep.value, unavailable.sleep);
  if (sleepHours != null) healthUpdate.sleepHours = sleepHours;
  if (dayTotals?.caloriesOut != null) healthUpdate.dailyCaloriesOut = dayTotals.caloriesOut;
  if (dayTotals?.hrv != null && dayTotals.hrv > 0) healthUpdate.hrv = dayTotals.hrv;
  if (dayTotals?.recoveryStatus) healthUpdate.recoveryStatus = dayTotals.recoveryStatus;

  if (!mergedSnapshot) {
    console.warn(
      `[syncFitbitData] ${provider} returned nothing usable for ${today} ` +
      `(unavailable: ${Object.keys(unavailable).join(',') || 'none'}) — keeping stored data.`,
    );
  }
  console.log(`[syncFitbitData] Writing health update for ${userId} (${today}):`, JSON.stringify(healthUpdate));

  try {
    await adminHealthService.updateHealthData(firestore, userId, healthUpdate);
    if (mergedSnapshot) {
      await adminHealthService.saveFitbitDailySnapshot(firestore, userId, today, mergedSnapshot);
    }
    // Stamp lastSyncedAt — reuse latestCreds (already in memory) to avoid a redundant re-fetch.
    await adminHealthService.saveFitbitCredentials(firestore, userId, {
      ...latestCreds,
      lastSyncedAt: Date.now(),
      timezoneOffset: finalOffset,
    });
  } catch (error) {
    console.error('[syncFitbitData] Firestore write failed after sync:', error);
    return { success: false, reason: 'write_failed' };
  }

  return { success: true };
}

/**
 * Syncs Fitbit data for a specific past date — updates ONLY the per-day
 * snapshot, never the main health doc fields (steps/HRV/sleepHours).
 *
 * Used when viewing a past date (e.g., finalising yesterday's score the
 * next morning) so you get the complete day's data without clobbering
 * today's live metrics.
 */
export async function syncFitbitSnapshot(userId: string, date: string, timezoneOffset?: number): Promise<SyncResult> {
  const firestore = getAdminFirestore();

  const creds = await adminHealthService.getFitbitCredentials(firestore, userId);
  if (!creds) return { success: false, reason: 'no_credentials' };
  const provider = creds.provider || 'fitbit';

  // Use provided offset, or fall back to stored one
  const finalOffset = timezoneOffset !== undefined ? timezoneOffset : creds.timezoneOffset;

  let accessToken = creds.accessToken;
  let latestCreds = creds;
  const fiveMinutes = 5 * 60 * 1000;
  if (Date.now() + fiveMinutes >= creds.expiresAt) {
    let refreshed;
    try {
      refreshed = await fitbitService.refreshAccessToken(creds.refreshToken, provider);
    } catch (error) {
      console.error('[syncFitbitSnapshot] Token refresh error:', error);
      // Double check if another process refreshed it
      const freshCreds = await adminHealthService.getFitbitCredentials(firestore, userId);
      if (freshCreds && freshCreds.expiresAt > Date.now() + fiveMinutes) {
        console.log('[syncFitbitSnapshot] Token refresh failed but found newer valid credentials in Firestore.');
        latestCreds = freshCreds;
        accessToken = freshCreds.accessToken;
      } else {
        return { success: false, reason: 'token_refresh_failed' };
      }
    }
    if (!refreshed && !accessToken) {
      console.error('[syncFitbitSnapshot] Token refresh returned null — token may be revoked.');
      // Double check if another process refreshed it
      const freshCreds = await adminHealthService.getFitbitCredentials(firestore, userId);
      if (freshCreds && freshCreds.expiresAt > Date.now() + fiveMinutes) {
        console.log('[syncFitbitSnapshot] Token refresh returned null but found newer valid credentials in Firestore.');
        latestCreds = freshCreds;
        accessToken = freshCreds.accessToken;
      } else {
        return { success: false, reason: 'token_refresh_failed' };
      }
    } else if (refreshed) {
      latestCreds = { 
        ...refreshed, 
        fitbitUserId: creds.fitbitUserId, 
        lastSyncedAt: creds.lastSyncedAt, 
        provider,
        timezoneOffset: finalOffset 
      };
      await adminHealthService.saveFitbitCredentials(firestore, userId, latestCreds);
      accessToken = refreshed.accessToken;
    }
  }

  let result;
  try {
    result = await fitbitService.syncTodayData(accessToken, date, provider, finalOffset);
  } catch (error: any) {
    if (error?.status === 401) {
      console.warn('[syncFitbitSnapshot] Token returned 401 Unauthorized. Attempting immediate refresh...');
      let refreshed;
      try {
        refreshed = await fitbitService.refreshAccessToken(latestCreds.refreshToken, provider);
      } catch (refreshErr) {
        console.error('[syncFitbitSnapshot] Token refresh threw an error after 401:', refreshErr);
        // Double check fallback
        const freshCreds = await adminHealthService.getFitbitCredentials(firestore, userId);
        if (freshCreds && freshCreds.expiresAt > Date.now() + fiveMinutes) {
          console.log('[syncFitbitSnapshot] Token refresh failed after 401 but found newer valid credentials in Firestore.');
          latestCreds = freshCreds;
          accessToken = freshCreds.accessToken;
        } else {
          return { success: false, reason: 'token_refresh_failed' };
        }
      }
      if (!refreshed && !accessToken) {
        console.error('[syncFitbitSnapshot] Token refresh returned null after 401 — token likely revoked.');
        // Double check fallback
        const freshCreds = await adminHealthService.getFitbitCredentials(firestore, userId);
        if (freshCreds && freshCreds.expiresAt > Date.now() + fiveMinutes) {
          console.log('[syncFitbitSnapshot] Token refresh returned null after 401 but found newer valid credentials in Firestore.');
          latestCreds = freshCreds;
          accessToken = freshCreds.accessToken;
        } else {
          return { success: false, reason: 'token_refresh_failed' };
        }
      } else if (refreshed) {
        latestCreds = { 
          ...refreshed, 
          fitbitUserId: latestCreds.fitbitUserId, 
          lastSyncedAt: latestCreds.lastSyncedAt, 
          provider,
          timezoneOffset: finalOffset 
        };
        await adminHealthService.saveFitbitCredentials(firestore, userId, latestCreds);
        accessToken = refreshed.accessToken;
      }
      
      try {
        result = await fitbitService.syncTodayData(accessToken, date, provider, finalOffset);
      } catch (retryErr) {
        console.error('[syncFitbitSnapshot] Fitbit API call failed on retry after refresh:', retryErr);
        const details = getErrorDetails(retryErr);
        return { success: false, reason: 'api_failed', details };
      }
    } else {
      console.error('[syncFitbitSnapshot] Fitbit API call failed:', error);
      const details = getErrorDetails(error);
      return { success: false, reason: 'api_failed', details };
    }
  }
  if (!result.success) return { success: false, reason: 'api_failed' };

  // Local date this snapshot is being captured on. When it is later than the
  // date being synced, the snapshot represents a completed day → final.
  const capturedLocal = new Date(Date.now() - ((finalOffset || 0) * 60000));
  const capturedOnDate = capturedLocal.toISOString().split('T')[0];

  const unavailable = result.unavailable ?? {};
  const hrv = result.hrv.value;
  const incomingSnapshot: import('./health-service').FitbitDailySnapshot = {
    steps: result.steps.value,
    sleepHours: result.sleep.value,
    capturedOnDate,
  };
  if (hrv > 0) {
    incomingSnapshot.hrv = hrv;
    incomingSnapshot.recoveryStatus = hrv >= 50 ? 'high' : hrv >= 30 ? 'medium' : 'low';
  } else if (!unavailable.sleep && result.sleep.value > 0) {
    // Google Health exposes no HRV — recovery is derived from sleep instead.
    incomingSnapshot.recoveryStatus =
      result.sleep.value >= 7 ? 'high' : result.sleep.value >= 6 ? 'medium' : 'low';
  }
  if (result.caloriesOut && result.caloriesOut.value > 0) {
    const calorieDiscount = provider === 'google' ? 1.0 : 0.90;
    let calsOut = result.caloriesOut.value * calorieDiscount;
    // See syncFitbitData: only an explicitly activity-only reading gets a BMR added.
    if (result.caloriesBasis === 'active-only') {
      const estimatedBmr = await estimateBmrFromProfile(firestore, userId);
      console.log(`[syncFitbitSnapshot] ${provider} reported activity burn only (${Math.round(calsOut)} kcal) — adding estimated BMR ${estimatedBmr}`);
      calsOut += estimatedBmr;
    } else if (provider === 'google' && calsOut < 1200) {
      console.warn(`[syncFitbitSnapshot] Google reported a full-day burn of only ${Math.round(calsOut)} kcal for ${date} (basis: ${result.caloriesBasis ?? 'unknown'}) — storing as-is.`);
    }
    incomingSnapshot.caloriesOut = Math.round(calsOut);
  }
  if (result.activities && result.activities.length > 0) {
    incomingSnapshot.activities = result.activities;
  }

  try {
    // ── Don't-regress guard ──────────────────────────────────────────────
    // Merge over what is already stored for this day: a metric the provider
    // couldn't give us, or one it reports lower than we already recorded,
    // keeps its stored value. This is what protects historical Fitbit-era
    // snapshots from being flattened when Google Health has no data for an
    // older date. A merge that changes nothing means there is nothing to
    // save — and nothing that could change the day's score either.
    const existingHealth = await adminHealthService.getHealthSummary(firestore, userId);
    const existingSnap = existingHealth?.fitbitByDate?.[date];
    const snapshot = mergeDailySnapshot(existingSnap, incomingSnapshot, unavailable);

    if (!snapshot) {
      console.log(
        `[syncFitbitSnapshot] Nothing new for ${date} ` +
        `(unavailable: ${Object.keys(unavailable).join(',') || 'none'}) — keeping existing data.`,
      );
      return { success: true }; // nothing to update, but not a failure
    }

    await adminHealthService.saveFitbitDailySnapshot(firestore, userId, date, snapshot);

    // Query logs and health data to recalculate score if history exists
    const [foodLogs, exerciseLogs, health, prefs] = await Promise.all([
      adminHealthService.queryFoodLog(firestore, userId, date, 50),
      adminHealthService.queryExerciseLog(firestore, userId, date, 50),
      adminHealthService.getHealthSummary(firestore, userId),
      adminHealthService.getUserPreferences(firestore, userId),
    ]);

    if (health?.history && health.history.length > 0) {
      const historyIndex = health.history.findIndex(h => (h.isoDate || h.date) === date);
      if (historyIndex !== -1) {
        const entry = health.history[historyIndex];
        
        const totalCaloriesIn = foodLogs.reduce((s, e) => s + (e.calories || 0), 0);
        const totalProteinG = foodLogs.reduce((s, e) => s + (e.proteinG || 0), 0);
        const totalAlcoholDrinks = foodLogs.reduce((s, e) => s + ((e as any).alcoholDrinks || 0), 0);
        const seedOilMeals = foodLogs.filter((e) => (e as any).hasSeedOils === true).length;

        const newResult = calculateDailyVFScore({
          caloriesIn: totalCaloriesIn,
          caloriesOut: snapshot.caloriesOut || entry.breakdown?.caloriesOut || health.dailyCaloriesOut || 2000,
          proteinG: totalProteinG,
          proteinGoal: entry.breakdown?.proteinGoal ?? prefs?.targets?.proteinGoal ?? 150,
          fastingHours: entry.breakdown?.fastingHours ?? 0,
          alcoholDrinks: totalAlcoholDrinks,
          sleepHours: snapshot.sleepHours || entry.breakdown?.sleepHours || 7,
          seedOilMeals,
          weightKg: health.weightKg,
          bodyFatPct: health.bodyFatPct,
          hrv: snapshot.hrv || health.fitbitByDate?.[date]?.hrv,
          foodLogs,
          exerciseLogs,
          fitbitActivities: snapshot.activities,
          // Preserve the consecutive-alcohol flag resolved at score time so a
          // re-sync doesn't silently drop the -25 penalty.
          alcoholYesterday: entry.breakdown?.alcoholYesterday,
        });

        const newScore = newResult.score;
        if (newScore !== entry.gain) {
          const diff = newScore - entry.gain;
          
          const updatedHistory = [...health.history];
          
          const updatedEntry: HistoryEntry = {
            ...entry,
            gain: newScore,
            status: newScore >= 0 ? 'Bullish' : 'Correction',
            detail: newResult.summary,
            equity: entry.equity + diff,
            breakdown: {
              ...entry.breakdown,
              caloriesIn: totalCaloriesIn,
              caloriesOut: snapshot.caloriesOut || entry.breakdown?.caloriesOut || health.dailyCaloriesOut || 2000,
              proteinG: totalProteinG,
              proteinGoal: entry.breakdown?.proteinGoal ?? prefs?.targets?.proteinGoal ?? 150,
              fastingHours: entry.breakdown?.fastingHours ?? 0,
              sleepHours: snapshot.sleepHours || entry.breakdown?.sleepHours || 7,
              ...newResult.breakdown,
            }
          };
          
          updatedHistory[historyIndex] = updatedEntry;
          
          // Update subsequent entries' cumulative equity
          for (let i = historyIndex + 1; i < updatedHistory.length; i++) {
            updatedHistory[i] = {
              ...updatedHistory[i],
              equity: updatedHistory[i].equity + diff
            };
          }
          
          const newVisceralFatPoints = (health.visceralFatPoints || 0) + diff;
          
          await adminHealthService.updateHealthData(firestore, userId, {
            history: updatedHistory,
            visceralFatPoints: newVisceralFatPoints
          });
          
          console.log(`[syncFitbitSnapshot] Updated history entry for ${date}. Diff: ${diff}, New Score: ${newScore}, New VF Points: ${newVisceralFatPoints}`);
        }
      }
    }
  } catch (error) {
    console.error('[syncFitbitSnapshot] Firestore write/recalculate failed:', error);
    return { success: false, reason: 'write_failed' };
  }

  return { success: true };
}

function addDaysIso(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/**
 * Decide whether a scored past day's device snapshot needs a fresh pull.
 *
 * A snapshot is stale when its caloriesOut can't be trusted as the finalised
 * full-day burn:
 *   • missing entirely  → the score used a BMR estimate,
 *   • no caloriesOut    → same, effectively estimated,
 *   • capturedOnDate ≤ date → captured mid-day, so burn is partial,
 *   • legacy (no capturedOnDate) → unknown; only refreshed for the most recent
 *     `legacyWindowDays` days to self-heal recent partials without re-pulling
 *     the entire history every session.
 */
function isSnapshotStale(
  date: string,
  snap: import('./health-service').FitbitDailySnapshot | undefined,
  legacyCutoffDate: string,
): boolean {
  if (!snap) return true;
  // Zero steps + zero sleep = bad data from a broken API call. Always re-sync.
  if (snap.steps === 0 && (snap.sleepHours === 0 || snap.sleepHours == null)) return true;
  if (snap.caloriesOut == null) return true;
  if (snap.capturedOnDate) return snap.capturedOnDate <= date;
  // Legacy snapshot with no capture metadata — only refresh recent days.
  return date >= legacyCutoffDate;
}

/**
 * Auto-finalise recent past days whose device snapshot is partial or missing.
 *
 * Walks the last `windowDays` days, and for each day that already carries a
 * score in history but whose snapshot isn't a trustworthy full-day burn,
 * re-pulls it via {@link syncFitbitSnapshot} — which fetches the finalised
 * caloriesOut AND rewrites that day's stored score (and cascades equity). This
 * removes the need to press "Sync Date" by hand to correct a provisional score.
 *
 * Runs sequentially to avoid concurrent token-refresh races, and only touches
 * days that have a history entry so it never calls Fitbit for days the user
 * never logged.
 */
export async function refreshStalePastSnapshots(
  userId: string,
  localDate: string,
  timezoneOffset?: number,
  // Two weeks rather than one: this is also the repair path for days a broken
  // provider sync flattened to zeroes, and those need a wide enough window to
  // be reachable. Only days that are actually stale are re-pulled, so a healthy
  // history costs nothing.
  windowDays = 14,
): Promise<{ ok: boolean; refreshed: number }> {
  const firestore = getAdminFirestore();

  const creds = await adminHealthService.getFitbitCredentials(firestore, userId);
  if (!creds) return { ok: false, refreshed: 0 };

  const health = await adminHealthService.getHealthSummary(firestore, userId);
  const history = health?.history ?? [];
  if (history.length === 0) return { ok: true, refreshed: 0 };

  const fitbitByDate = health?.fitbitByDate ?? {};
  const legacyCutoffDate = addDaysIso(localDate, -3); // legacy snapshots: last 3 days only
  const windowStart = addDaysIso(localDate, -windowDays);

  // Scored past days (exclude today) that fall inside the window, newest first
  // so the most-relevant recent days are corrected even if we hit an error.
  const staleDates = history
    .map((h) => h.isoDate)
    .filter((d): d is string => !!d && d < localDate && d >= windowStart)
    .filter((d) => isSnapshotStale(d, fitbitByDate[d], legacyCutoffDate))
    .sort((a, b) => b.localeCompare(a));

  if (staleDates.length === 0) return { ok: true, refreshed: 0 };

  let refreshed = 0;
  for (const date of staleDates) {
    try {
      const res = await syncFitbitSnapshot(userId, date, timezoneOffset);
      if (res.success) refreshed++;
    } catch (err) {
      console.error(`[refreshStalePastSnapshots] Failed to refresh ${date}:`, err);
    }
  }

  console.log(`[refreshStalePastSnapshots] Refreshed ${refreshed}/${staleDates.length} stale day(s) for ${userId}.`);
  return { ok: true, refreshed };
}

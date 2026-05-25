import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService } from '@/lib/health-service-admin';
import { fitbitService, FitbitApiError } from '@/lib/fitbit-service';
import { calculateDailyVFScore } from './vf-scoring';
import type { HistoryEntry } from './health-service';

/** How often (ms) background sync should run — 6 hours. */
export const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

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

  const healthUpdate: Record<string, unknown> = {
    steps: result.steps.value,
    sleepHours: result.sleep.value,
    lastActiveDate: today,
  };

  console.log(`[syncFitbitData] Writing health update for ${userId} (${today}):`, JSON.stringify(healthUpdate));

  if (result.caloriesOut && result.caloriesOut.value > 0) {
    // Fitbit TDEE estimates run ~10% high — apply a conservative accuracy adjustment.
    healthUpdate.dailyCaloriesOut = Math.round(result.caloriesOut.value * 0.90);
  }

  // Only update HRV and recoveryStatus when Fitbit returns a valid reading.
  // A value of 0 means the sensor failed or data is unavailable — ignore it
  // so stale-but-valid data isn't overwritten by a bad reading.
  const hrv = result.hrv.value;
  if (hrv > 0) {
    healthUpdate.hrv = hrv;
    if (hrv >= 50) healthUpdate.recoveryStatus = 'high';
    else if (hrv >= 30) healthUpdate.recoveryStatus = 'medium';
    else healthUpdate.recoveryStatus = 'low';
  }

  // Build the daily snapshot for historical lookups (steps/HRV visible on past days).
  const dailySnapshot: import('./health-service').FitbitDailySnapshot = {
    steps: result.steps.value,
    sleepHours: result.sleep.value,
  };
  if (hrv > 0) {
    dailySnapshot.hrv = hrv;
    dailySnapshot.recoveryStatus = healthUpdate.recoveryStatus as 'low' | 'medium' | 'high';
  }
  if (healthUpdate.dailyCaloriesOut) {
    dailySnapshot.caloriesOut = healthUpdate.dailyCaloriesOut as number;
  }
  if (result.activities && result.activities.length > 0) {
    dailySnapshot.activities = result.activities;
  }

  try {
    await adminHealthService.updateHealthData(firestore, userId, healthUpdate);
    await adminHealthService.saveFitbitDailySnapshot(firestore, userId, today, dailySnapshot);
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

  const hrv = result.hrv.value;
  const snapshot: import('./health-service').FitbitDailySnapshot = {
    steps: result.steps.value,
    sleepHours: result.sleep.value,
  };
  if (hrv > 0) {
    snapshot.hrv = hrv;
    snapshot.recoveryStatus = hrv >= 50 ? 'high' : hrv >= 30 ? 'medium' : 'low';
  }
  if (result.caloriesOut && result.caloriesOut.value > 0) {
    snapshot.caloriesOut = Math.round(result.caloriesOut.value * 0.90);
  }
  if (result.activities && result.activities.length > 0) {
    snapshot.activities = result.activities;
  }

  try {
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
          caloriesOut: snapshot.caloriesOut ?? entry.breakdown?.caloriesOut ?? health.dailyCaloriesOut ?? 2000,
          proteinG: totalProteinG,
          proteinGoal: entry.breakdown?.proteinGoal ?? prefs?.targets?.proteinGoal ?? 150,
          fastingHours: entry.breakdown?.fastingHours ?? 0,
          alcoholDrinks: totalAlcoholDrinks,
          sleepHours: snapshot.sleepHours ?? entry.breakdown?.sleepHours ?? 7,
          seedOilMeals,
          weightKg: health.weightKg,
          bodyFatPct: health.bodyFatPct,
          hrv: snapshot.hrv ?? health.fitbitByDate?.[date]?.hrv,
          foodLogs,
          exerciseLogs,
          fitbitActivities: snapshot.activities,
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
              caloriesOut: snapshot.caloriesOut ?? entry.breakdown?.caloriesOut ?? health.dailyCaloriesOut ?? 2000,
              proteinG: totalProteinG,
              proteinGoal: entry.breakdown?.proteinGoal ?? prefs?.targets?.proteinGoal ?? 150,
              fastingHours: entry.breakdown?.fastingHours ?? 0,
              alcoholDrinks: totalAlcoholDrinks,
              sleepHours: snapshot.sleepHours ?? entry.breakdown?.sleepHours ?? 7,
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

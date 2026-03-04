
import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService } from '@/lib/health-service-admin';
import { fitbitService } from '@/lib/fitbit-service';
import { SYNC_INTERVAL_MS } from '@/app/actions/fitbit';

/**
 * @fileOverview Cron endpoint that syncs Fitbit data for all connected users.
 *
 * Designed to be called every 6 hours by an external scheduler (Cloud Scheduler,
 * cron-job.org, GitHub Actions, etc.).
 *
 * Protected by a shared secret in the `CRON_SECRET` env var. If the var is not
 * set, the endpoint is disabled (returns 403).
 *
 * GET /api/cron/fitbit-sync?secret=<CRON_SECRET>
 */

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // --- Auth gate ---
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured — cron endpoint disabled.' },
      { status: 403 },
    );
  }

  const providedSecret = request.nextUrl.searchParams.get('secret');
  if (providedSecret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const firestore = getAdminFirestore();

  // Find all users with stored Fitbit tokens via a collection-group query
  // on the "preferences" sub-collection where the doc id is "fitbit_tokens".
  // Since Firestore doesn't support collection-group queries on specific doc
  // ids elegantly, we iterate all user docs that have isDeviceVerified = true.
  const usersSnapshot = await firestore
    .collection('users')
    .where('isDeviceVerified', '==', true)
    .get();

  const now = Date.now();
  const results: { userId: string; success: boolean; skipped?: boolean }[] = [];

  for (const userDoc of usersSnapshot.docs) {
    const userId = userDoc.id;

    try {
      const creds = await adminHealthService.getFitbitCredentials(firestore, userId);
      if (!creds) {
        results.push({ userId, success: false });
        continue;
      }

      // Skip if synced recently (within the interval).
      if (creds.lastSyncedAt && now - creds.lastSyncedAt < SYNC_INTERVAL_MS) {
        results.push({ userId, success: true, skipped: true });
        continue;
      }

      // Refresh token if near expiry.
      let accessToken = creds.accessToken;
      const fiveMinutes = 5 * 60 * 1000;
      if (now + fiveMinutes >= creds.expiresAt) {
        const refreshed = await fitbitService.refreshAccessToken(creds.refreshToken);
        if (!refreshed) {
          console.error(`[CronSync] Token refresh failed for user ${userId}`);
          results.push({ userId, success: false });
          continue;
        }
        await adminHealthService.saveFitbitCredentials(firestore, userId, {
          ...refreshed,
          fitbitUserId: creds.fitbitUserId,
          lastSyncedAt: creds.lastSyncedAt,
        });
        accessToken = refreshed.accessToken;
      }

      // Fetch today's data.
      const syncResult = await fitbitService.syncTodayData(accessToken);

      if (syncResult.success) {
        const healthUpdate: Record<string, unknown> = {
          steps: syncResult.steps.value,
          sleepHours: syncResult.sleep.value,
          hrv: syncResult.hrv.value,
        };
        if (syncResult.caloriesOut && syncResult.caloriesOut.value > 0) {
          healthUpdate.dailyCaloriesOut = syncResult.caloriesOut.value;
        }
        const hrv = syncResult.hrv.value;
        if (hrv >= 50) healthUpdate.recoveryStatus = 'high';
        else if (hrv >= 30) healthUpdate.recoveryStatus = 'medium';
        else if (hrv > 0) healthUpdate.recoveryStatus = 'low';

        await adminHealthService.updateHealthData(firestore, userId, healthUpdate);

        // Stamp lastSyncedAt.
        const latestCreds = await adminHealthService.getFitbitCredentials(firestore, userId);
        if (latestCreds) {
          await adminHealthService.saveFitbitCredentials(firestore, userId, {
            ...latestCreds,
            lastSyncedAt: Date.now(),
          });
        }
      }

      results.push({ userId, success: syncResult.success });
    } catch (error) {
      console.error(`[CronSync] Failed for user ${userId}:`, error);
      results.push({ userId, success: false });
    }
  }

  const synced = results.filter(r => r.success && !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;
  const failed = results.filter(r => !r.success).length;

  return NextResponse.json({
    ok: true,
    total: results.length,
    synced,
    skipped,
    failed,
  });
}

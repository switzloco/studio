import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/firebase/admin';
import { syncFitbitData, SYNC_INTERVAL_MS } from '@/lib/fitbit-sync';
import { adminHealthService } from '@/lib/health-service-admin';

/**
 * @fileOverview Cron endpoint that syncs Fitbit data for ALL connected users.
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
export const maxDuration = 300; // 5 minutes max for serverless execution

/** Process users in parallel batches of this size. */
const BATCH_SIZE = 5;

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

  // Query all users who have connected Fitbit.
  const usersSnapshot = await firestore
    .collection('users')
    .where('isDeviceVerified', '==', true)
    .get();

  const now = Date.now();
  const results: { userId: string; status: 'synced' | 'skipped' | 'failed' }[] = [];

  // Filter to only users that are stale (no sync within the interval).
  const staleUsers: string[] = [];
  for (const userDoc of usersSnapshot.docs) {
    const userId = userDoc.id;
    const creds = await adminHealthService.getFitbitCredentials(firestore, userId);
    if (!creds) {
      results.push({ userId, status: 'failed' });
      continue;
    }
    if (creds.lastSyncedAt && now - creds.lastSyncedAt < SYNC_INTERVAL_MS) {
      results.push({ userId, status: 'skipped' });
      continue;
    }
    staleUsers.push(userId);
  }

  // Process stale users in parallel batches.
  for (let i = 0; i < staleUsers.length; i += BATCH_SIZE) {
    const batch = staleUsers.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (userId) => {
        const { success } = await syncFitbitData(userId);
        return { userId, success };
      }),
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push({
          userId: result.value.userId,
          status: result.value.success ? 'synced' : 'failed',
        });
      } else {
        // Promise rejected — extract userId from the batch by index.
        const idx = batchResults.indexOf(result);
        results.push({ userId: batch[idx], status: 'failed' });
        console.error(`[CronSync] Unexpected error for user ${batch[idx]}:`, result.reason);
      }
    }
  }

  const synced = results.filter(r => r.status === 'synced').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const failed = results.filter(r => r.status === 'failed').length;

  return NextResponse.json({
    ok: true,
    total: results.length,
    synced,
    skipped,
    failed,
  });
}

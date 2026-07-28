import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/firebase/admin';

/**
 * @fileOverview Cron endpoint to clean up stale anonymous users (>30 days inactive).
 * GET /api/cron/cleanup-anonymous?secret=<CRON_SECRET>
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured — endpoint disabled.' },
      { status: 403 }
    );
  }

  const providedSecret = request.nextUrl.searchParams.get('secret');
  if (providedSecret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const firestore = getAdminFirestore();

  // Compute 30 days ago cutoff date string (YYYY-MM-DD)
  const now = new Date();
  const cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const cutoffStr = cutoffDate.toISOString().slice(0, 10);

  const usersSnap = await firestore.collection('users').get();
  const prunedUserIds: string[] = [];

  for (const doc of usersSnap.docs) {
    const data = doc.data();
    const isAnonymous = data.isAnonymous === true || !data.displayName;
    const lastActiveDate = data.lastActiveDate || '1970-01-01';

    // Target ONLY anonymous users who have been inactive for > 30 days
    if (isAnonymous && lastActiveDate < cutoffStr) {
      const userId = doc.id;

      // Delete subcollections: food_log, exercise_log, chat_sessions, preferences
      const subcollections = ['food_log', 'exercise_log', 'chat_sessions', 'preferences'];
      for (const sub of subcollections) {
        const subSnap = await firestore.collection(`users/${userId}/${sub}`).get();
        const batch = firestore.batch();
        subSnap.docs.forEach((subDoc) => batch.delete(subDoc.ref));
        await batch.commit();
      }

      // Delete the main user doc
      await doc.ref.delete();
      prunedUserIds.push(userId);
    }
  }

  return NextResponse.json({
    ok: true,
    cutoffDate: cutoffStr,
    totalEvaluated: usersSnap.size,
    prunedCount: prunedUserIds.length,
    prunedUserIds,
  });
}

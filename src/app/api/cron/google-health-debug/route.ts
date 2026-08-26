import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService } from '@/lib/health-service-admin';
import { fitbitService, diagnoseGoogleHealthCalories } from '@/lib/fitbit-service';

/**
 * @fileOverview Read-only diagnostic for Google Health calorie burn.
 *
 * `total-calories` is rollup-only, so when it reports a figure that looks too
 * low there is no way to inspect its individual intervals. This cross-checks it
 * against a multi-day series, an hourly breakdown, and the listable
 * active/basal halves — enough to tell a genuinely low reading apart from a
 * partial day or a mislabelled basal stream.
 *
 * Reads only; it writes nothing and changes no stored data.
 *
 * GET /api/cron/google-health-debug?secret=<CRON_SECRET>[&userId=][&date=YYYY-MM-DD][&days=7]
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured — diagnostic endpoint disabled.' },
      { status: 403 },
    );
  }
  if (request.nextUrl.searchParams.get('secret') !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const firestore = getAdminFirestore();
  let userId = request.nextUrl.searchParams.get('userId') ?? undefined;

  // No userId given — find the single connected Google Health user.
  if (!userId) {
    const users = await firestore.collection('users').where('connectedDevice', '==', 'google').get();
    if (users.empty) {
      return NextResponse.json({ error: 'No user with connectedDevice=google found; pass ?userId=' }, { status: 404 });
    }
    if (users.size > 1) {
      return NextResponse.json(
        { error: 'Multiple Google Health users; pass ?userId=', candidates: users.docs.map((d) => d.id) },
        { status: 400 },
      );
    }
    userId = users.docs[0].id;
  }

  const creds = await adminHealthService.getFitbitCredentials(firestore, userId);
  if (!creds) return NextResponse.json({ error: `No credentials stored for ${userId}` }, { status: 404 });
  if ((creds.provider ?? 'fitbit') !== 'google') {
    return NextResponse.json({ error: `User ${userId} is on provider '${creds.provider}', not Google Health` }, { status: 400 });
  }

  // Refresh if the token is close to expiry, but don't persist — this endpoint stays read-only.
  let accessToken = creds.accessToken;
  if (Date.now() + 5 * 60 * 1000 >= creds.expiresAt) {
    const refreshed = await fitbitService.refreshAccessToken(creds.refreshToken, 'google');
    if (!refreshed) return NextResponse.json({ error: 'Token refresh failed — reconnect Google Health' }, { status: 401 });
    accessToken = refreshed.accessToken;
  }

  const tzOffset = creds.timezoneOffset ?? 0;
  const localNow = new Date(Date.now() - tzOffset * 60_000);
  const yesterday = new Date(localNow.getTime() - 86_400_000).toISOString().slice(0, 10);
  const date = request.nextUrl.searchParams.get('date') ?? yesterday;
  const days = Math.min(14, Math.max(1, Number(request.nextUrl.searchParams.get('days') ?? 7)));

  try {
    const [diagnostic, health] = await Promise.all([
      diagnoseGoogleHealthCalories(accessToken, date, tzOffset, days),
      adminHealthService.getHealthSummary(firestore, userId),
    ]);

    return NextResponse.json({
      userId,
      storedSnapshot: health?.fitbitByDate?.[date] ?? null,
      storedProfile: { weightKg: health?.weightKg ?? null, heightCm: health?.heightCm ?? null },
      ...diagnostic,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? String(err), body: err?.body?.slice?.(0, 500) },
      { status: 502 },
    );
  }
}

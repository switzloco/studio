import { NextRequest, NextResponse } from 'next/server';
import { sendFounderUserSummaryNow } from '@/ai/flows/admin-reports';

/**
 * @fileOverview Every-3-days founder user & outreach summary email cron endpoint.
 *
 * Cloud Scheduler calls daily at 8:00 AM PT (`0 8 * * *`):
 *   GET /api/cron/user-summary?secret=<CRON_SECRET>
 *
 * Enforces an exact 3-day (72h, 68h threshold for clock jitter) cadence in Firestore
 * (`admin_state/user_summary_3d`) so month boundaries (31 -> 1) never double-fire.
 * Pass `&force=1` to trigger an immediate on-demand summary.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured — cron endpoint disabled.' },
      { status: 403 },
    );
  }

  const querySecret = request.nextUrl.searchParams.get('secret');
  const authHeader = request.headers.get('authorization');
  const bearerSecret = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (querySecret !== cronSecret && bearerSecret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const daysParam = Number(request.nextUrl.searchParams.get('days') || '3');
  const force = request.nextUrl.searchParams.get('force') === '1';

  try {
    const result = await sendFounderUserSummaryNow({
      periodDays: Number.isFinite(daysParam) && daysParam >= 1 ? daysParam : 3,
      force,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (error) {
    console.error('[UserSummaryCron] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 },
    );
  }
}

export const POST = GET;

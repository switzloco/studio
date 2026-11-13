import { NextRequest, NextResponse } from 'next/server';
import { generateFounderUserSummary } from '@/ai/flows/admin-reports';
import { renderUserSummaryEmailHtml } from '@/lib/admin-metrics';
import { sendAdminReportEmail } from '@/lib/admin-email';

/**
 * @fileOverview Cron endpoint to trigger a 7-day (or custom `?days=N`) executive summary.
 * GET /api/cron/weekly-summary?secret=<CRON_SECRET>
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured.' },
      { status: 403 },
    );
  }

  const querySecret = request.nextUrl.searchParams.get('secret');
  const authHeader = request.headers.get('authorization');
  const bearerSecret = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (querySecret !== cronSecret && bearerSecret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const daysParam = Number(request.nextUrl.searchParams.get('days') || '7');
    const periodDays = Number.isFinite(daysParam) && daysParam >= 1 ? daysParam : 7;

    const { summary, metrics } = await generateFounderUserSummary(periodDays);
    const emailHtml = renderUserSummaryEmailHtml({ metrics, summary });

    const result = await sendAdminReportEmail(
      'nicholas.switzer@gmail.com',
      `[the CFO] ${metrics.periodDays}d User Summary · ${metrics.activeUsersPeriod} Active / ${metrics.wau} WAU`,
      emailHtml,
    );

    return NextResponse.json({
      ok: result.success,
      metrics,
      emailSent: result.success,
    });
  } catch (error) {
    console.error('Weekly summary error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 },
    );
  }
}

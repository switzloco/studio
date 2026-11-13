import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService } from '@/lib/health-service-admin';
import type { OutreachWindow } from '@/lib/health-service';
import { resolveLocalClock } from '@/lib/outreach-auth';
import { dispatchOutreachForUser } from '@/lib/outreach-service';
import { pollGmailOutreachReplies } from '@/lib/outreach-gmail-inbound';
import { pollDiscordOutreachReplies } from '@/lib/outreach-discord-inbound';

/**
 * @fileOverview 5-minute cron endpoint for inbound Gmail reply polling + 3x/day outreach.
 *
 * Schedule every 5 minutes in Cloud Scheduler:
 *   GET /api/cron/outreach-dispatch?secret=<CRON_SECRET>
 *
 * Polls Gmail IMAP (`[Gmail]/All Mail` via `X-GM-RAW`) for replies to `+cfo@` and
 * evaluates each enrolled user's local timezone hour against their configured
 * `morningHour` (default 7), `middayHour` (default 12), and `nightHour` (default 19),
 * deduplicating each window via `lastDispatchedKey`.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BATCH_SIZE = 10;

function matchWindowForHour(params: {
  hour: number;
  morningHour?: number;
  middayHour?: number;
  nightHour?: number;
}): OutreachWindow | null {
  const m = params.morningHour ?? 7;
  const d = params.middayHour ?? 12;
  const n = params.nightHour ?? 19;
  if (params.hour === m) return 'morning';
  if (params.hour === d) return 'midday';
  if (params.hour === n) return 'night';
  return null;
}

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

  const now = new Date();
  const forceUid = request.nextUrl.searchParams.get('uid');
  const forceWindowParam = request.nextUrl.searchParams.get('forceWindow') as OutreachWindow | null;

  // Optional single-user targeted dispatch for admin verification
  if (forceUid && forceWindowParam && ['morning', 'midday', 'night'].includes(forceWindowParam)) {
    const single = await dispatchOutreachForUser({
      uid: forceUid,
      window: forceWindowParam,
      now,
      force: true,
    });
    return NextResponse.json({ ok: true, mode: 'single', uid: forceUid, ...single });
  }

  const [inboundReplies, discordInbound] = await Promise.all([
    pollGmailOutreachReplies(),
    pollDiscordOutreachReplies(),
  ]);

  const db = getAdminFirestore();
  const snapshot = await db
    .collection('users')
    .where('outreachEnabled', '==', true)
    .get();

  const dueQueue: Array<{ uid: string; window: OutreachWindow }> = [];
  let checked = 0;

  for (const userDoc of snapshot.docs) {
    checked++;
    const uid = userDoc.id;
    const prefs = await adminHealthService.getUserPreferences(db, uid);
    const outreach = prefs?.outreach;
    if (!outreach?.enabled) continue;

    const clock = resolveLocalClock(now, outreach.timezone);
    const matchedWindow = matchWindowForHour({
      hour: clock.hour,
      morningHour: outreach.morningHour,
      middayHour: outreach.middayHour,
      nightHour: outreach.nightHour,
    });

    if (!matchedWindow) continue;
    if (outreach.lastDispatchedKey === `${clock.localDate}:${matchedWindow}`) continue;

    dueQueue.push({ uid, window: matchedWindow });
  }

  let sent = 0;
  let skipped = 0;
  let autoPaused = 0;
  let failed = 0;

  for (let i = 0; i < dueQueue.length; i += BATCH_SIZE) {
    const batch = dueQueue.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map((item) =>
        dispatchOutreachForUser({
          uid: item.uid,
          window: item.window,
          now,
        }),
      ),
    );

    for (const res of settled) {
      if (res.status === 'fulfilled') {
        if (res.value.status === 'sent') sent++;
        else if (res.value.status === 'auto_paused') autoPaused++;
        else if (res.value.status === 'skipped') skipped++;
        else failed++;
      } else {
        failed++;
        console.error('[OutreachCron] Dispatch error:', res.reason);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    inboundReplies,
    discordInbound,
    enrolledChecked: checked,
    dueNow: dueQueue.length,
    sent,
    skipped,
    autoPaused,
    failed,
  });
}

export const POST = GET;

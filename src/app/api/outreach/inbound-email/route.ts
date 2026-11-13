import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/firebase/admin';
import { processOutreachFreeTextMeal } from '@/lib/outreach-service';
import { sendOutreachReplyConfirmationEmail } from '@/lib/outreach-email';

/**
 * @fileOverview Inbound Email Reply Webhook (compatible with Resend Inbound / Cloudflare Email Workers).
 *
 * POST /api/outreach/inbound-email?secret=<OUTREACH_WEBHOOK_SECRET_OR_CRON_SECRET>
 *
 * Accepts either a direct `{ from, text, subject }` JSON payload or a Resend
 * `{ type: 'email.received', data: { from, text, ... } }` envelope.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function extractEmailAddress(rawFrom?: string): string | null {
  if (!rawFrom || typeof rawFrom !== 'string') return null;
  const angleMatch = rawFrom.match(/<([^>]+@[^>]+)>/);
  const candidate = (angleMatch ? angleMatch[1] : rawFrom).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.OUTREACH_WEBHOOK_SECRET || process.env.CRON_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ error: 'Webhook secret not configured.' }, { status: 403 });
  }

  const providedSecret =
    request.nextUrl.searchParams.get('secret') ||
    request.headers.get('x-webhook-secret');

  if (providedSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const payload = body?.data && typeof body.data === 'object' ? body.data : body;
  const senderEmail = extractEmailAddress(
    Array.isArray(payload?.from) ? payload.from[0] : payload?.from,
  );
  const rawText = String(payload?.text || payload?.plainText || payload?.subject || '').trim();

  if (!senderEmail || !rawText) {
    return NextResponse.json({ ok: false, reason: 'missing_sender_or_text' });
  }

  const db = getAdminFirestore();
  const userSnap = await db
    .collection('users')
    .where('outreachEmail', '==', senderEmail)
    .limit(1)
    .get();

  if (userSnap.empty) {
    return NextResponse.json({ ok: false, reason: 'unknown_sender' });
  }

  const uid = userSnap.docs[0].id;
  const result = await processOutreachFreeTextMeal({ uid, rawText });

  await sendOutreachReplyConfirmationEmail({
    to: senderEmail,
    uid,
    subject: `the CFO: ${result.headline}`,
    headline: result.headline,
    detail: result.detail,
  });

  return NextResponse.json({
    ok: true,
    uid,
    status: result.status,
    headline: result.headline,
  });
}

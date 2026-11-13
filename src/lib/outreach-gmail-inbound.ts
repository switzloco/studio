/**
 * @fileOverview Zero-DNS Gmail IMAP Inbound Reply Poller for CFO Outreach.
 *
 * Outbound briefings set `Reply-To: the CFO <localpart+cfo@gmail.com>`.
 * This poller queries IMAP (`imap.gmail.com:993`) ONLY for unread messages
 * addressed to that `+cfo@` alias — never touching personal inbox mail —
 * parses meal replies via `processOutreachFreeTextMeal`, marks them Seen,
 * and replies with an updated Eat-By confirmation email.
 */

import { createHash } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { ImapFlow } from 'imapflow';
import { getAdminFirestore } from '@/firebase/admin';
import {
  resolveGmailOutreachConfig,
  sendOutreachReplyConfirmationEmail,
} from './outreach-email';
import { processOutreachFreeTextMeal } from './outreach-service';

function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"');
}

/**
 * Lightweight MIME plain-text extractor for short email replies.
 */
export function extractPlainTextFromRawMime(rawBuffer: Buffer): string {
  const raw = rawBuffer.toString('utf8');
  const headerSplitIdx = raw.search(/\r?\n\r?\n/);
  if (headerSplitIdx === -1) return raw.trim();

  const headersPart = raw.slice(0, headerSplitIdx);
  const bodyPart = raw.slice(headerSplitIdx).replace(/^\r?\n\r?\n/, '');

  const boundaryMatch = headersPart.match(/boundary="?([^"\r\n;]+)"?/i);
  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = bodyPart.split(`--${boundary}`);
    let htmlFallback = '';

    for (const part of parts) {
      const subIdx = part.search(/\r?\n\r?\n/);
      if (subIdx === -1) continue;
      const partHeaders = part.slice(0, subIdx);
      let content = part.slice(subIdx).replace(/^\r?\n\r?\n/, '');
      // Remove trailing closing "--" marker if present
      content = content.replace(/\r?\n--\s*$/, '').trim();

      const isBase64 = /Content-Transfer-Encoding:\s*base64/i.test(partHeaders);
      const isQP = /Content-Transfer-Encoding:\s*quoted-printable/i.test(partHeaders);

      if (isBase64) {
        try {
          content = Buffer.from(content.replace(/\s+/g, ''), 'base64').toString('utf8');
        } catch {
          // Keep raw fallback
        }
      } else if (isQP) {
        content = decodeQuotedPrintable(content);
      }

      if (/Content-Type:\s*text\/plain/i.test(partHeaders)) {
        return content.trim();
      }
      if (/Content-Type:\s*text\/html/i.test(partHeaders) && !htmlFallback) {
        htmlFallback = stripHtmlTags(content).trim();
      }
    }

    if (htmlFallback) return htmlFallback;
  }

  // Single-part message
  const isBase64 = /Content-Transfer-Encoding:\s*base64/i.test(headersPart);
  const isQP = /Content-Transfer-Encoding:\s*quoted-printable/i.test(headersPart);
  let decoded = bodyPart;
  if (isBase64) {
    try {
      decoded = Buffer.from(bodyPart.replace(/\s+/g, ''), 'base64').toString('utf8');
    } catch {
      // Ignore
    }
  } else if (isQP) {
    decoded = decodeQuotedPrintable(bodyPart);
  }
  if (/Content-Type:\s*text\/html/i.test(headersPart)) {
    return stripHtmlTags(decoded).trim();
  }
  return decoded.trim();
}

function buildGmailReceiptId(messageIdHeader: string | undefined, msgUid: number): string {
  const cleanMsgId = (messageIdHeader || '').trim().toLowerCase();
  if (cleanMsgId) {
    const digest = createHash('sha256').update(cleanMsgId).digest('hex').slice(0, 24);
    return `gmail_mid_${digest}`;
  }
  return `gmail_uid_${msgUid}`;
}

export async function pollGmailOutreachReplies(): Promise<{
  polled: boolean;
  processed: number;
  errors: number;
}> {
  const gmail = resolveGmailOutreachConfig();
  if (!gmail) {
    return { polled: false, processed: 0, errors: 0 };
  }

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    socketTimeout: 20_000,
    greetingTimeout: 10_000,
    auth: {
      user: gmail.user,
      pass: gmail.appPassword,
    },
    logger: false,
  });

  // Prevent unhandled error event crashes if socket drops mid-poll
  client.on('error', (err) => {
    console.warn('[GmailInbound] IMAP socket error:', err?.message ?? String(err));
  });

  let processed = 0;
  let errors = 0;

  try {
    await client.connect();

    // Open '[Gmail]/All Mail' so BOTH external replies (INBOX) AND self-replies
    // from the sender account itself (\Sent) are captured, even if viewed in Gmail.
    let lock;
    try {
      lock = await client.getMailboxLock('[Gmail]/All Mail');
    } catch {
      lock = await client.getMailboxLock('INBOX');
    }

    try {
      let uids: number[] | false | undefined;
      try {
        // Gmail X-GM-RAW indexed search executes in ~250ms instead of scanning all headers
        uids = await client.search(
          { gmraw: `to:${gmail.plusReplyTo} newer_than:2d` } as any,
          { uid: true },
        );
      } catch {
        uids = await client.search(
          { seen: false, to: gmail.plusReplyTo },
          { uid: true },
        );
      }

      if (!uids || uids.length === 0) {
        return { polled: true, processed: 0, errors: 0 };
      }

      // Newest messages first, capped at 15 per poll
      const targetUids = [...uids].sort((a, b) => b - a).slice(0, 15);
      const db = getAdminFirestore();

      for (const msgUid of targetUids) {
        try {
          const msg = await client.fetchOne(
            String(msgUid),
            {
              uid: true,
              envelope: true,
              headers: [
                'message-id',
                'to',
                'delivered-to',
                'from',
                'subject',
                'auto-submitted',
                'x-autoreply',
              ],
              source: { maxLength: 65536 },
            },
            { uid: true },
          );

          if (!msg || !msg.source) continue;

          const headerText = msg.headers ? msg.headers.toString('utf8') : '';
          const headerLower = headerText.toLowerCase();

          // Safety guard 1: strictly require "+cfo@" in To / Delivered-To or envelope.to
          const envToMatch = (msg.envelope?.to ?? []).some((addr) =>
            (addr.address || '').toLowerCase().includes('+cfo@'),
          );
          if (!envToMatch && !headerLower.includes('+cfo@')) {
            continue;
          }

          // Safety guard 2: never re-ingest our own outbound briefings ("From: the CFO <...>")
          const fromEntry = msg.envelope?.from?.[0];
          const fromName = (fromEntry?.name || '').trim().toLowerCase();
          if (fromName === 'the cfo' || /^from:\s*"?the cfo"?\s*</im.test(headerText)) {
            continue;
          }

          // Safety guard 3: skip vacation / bounce auto-responders
          if (
            /auto-submitted:\s*(?!no\b)/i.test(headerText) ||
            /x-autoreply:/i.test(headerText)
          ) {
            continue;
          }

          const fromAddr = fromEntry?.address?.trim().toLowerCase();
          if (!fromAddr || fromAddr.includes('mailer-daemon') || fromAddr.includes('noreply')) {
            continue;
          }

          const userSnap = await db
            .collection('users')
            .where('outreachEmail', '==', fromAddr)
            .limit(1)
            .get();

          if (userSnap.empty) continue;

          const userId = userSnap.docs[0].id;
          const messageIdMatch = headerText.match(/^message-id:\s*(.+)$/im);
          const messageId = messageIdMatch?.[1]?.trim() || msg.envelope?.messageId;
          const receiptId = buildGmailReceiptId(messageId, msgUid);
          const receiptRef = db.doc(`users/${userId}/outreach_actions/${receiptId}`);

          // Idempotency guard: guarantee each Gmail reply is processed at most once
          const existingReceipt = await receiptRef.get();
          if (existingReceipt.exists) {
            continue;
          }

          const plainText = extractPlainTextFromRawMime(msg.source);
          if (!plainText) continue;

          // Claim receipt + mark \Seen before LLM/email execution so retries never double-log
          await receiptRef.set({
            source: 'gmail_imap',
            msgUid,
            messageId: messageId ?? null,
            createdAt: FieldValue.serverTimestamp(),
          });
          await client.messageFlagsAdd(String(msgUid), ['\\Seen'], { uid: true }).catch(() => {});

          const result = await processOutreachFreeTextMeal({
            uid: userId,
            rawText: plainText,
            now: msg.envelope?.date instanceof Date ? msg.envelope.date : undefined,
          });

          await receiptRef.set(
            {
              status: result.status,
              headline: result.headline,
              foodId: result.loggedFoodId ?? null,
            },
            { merge: true },
          );

          await sendOutreachReplyConfirmationEmail({
            to: fromAddr,
            uid: userId,
            subject: `the CFO: ${result.headline}`,
            headline: result.headline,
            detail: result.detail,
            loggedFoodId: result.loggedFoodId,
            localDate: result.localDate,
            loggedMacros: result.loggedMacros,
            updatedHeadline: result.updatedHeadline,
            updatedBody: result.updatedBody,
            metricsLine: result.metricsLine,
            statusTone: result.statusTone,
          });

          processed++;
        } catch (itemErr) {
          errors++;
          console.error('[GmailInbound] Failed processing reply UID:', msgUid, itemErr);
        }
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    errors++;
    console.error('[GmailInbound] IMAP poll error:', err);
  } finally {
    await client.logout().catch(() => {});
  }

  return { polled: true, processed, errors };
}

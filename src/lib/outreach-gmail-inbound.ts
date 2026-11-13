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
import type { OutreachImageAttachment } from '@/ai/flows/outreach-meal-parser';
import {
  resolveGmailOutreachConfig,
  sendOutreachReplyConfirmationEmail,
} from './outreach-email';
import { processOutreachFreeTextMeal } from './outreach-service';

const MAX_INBOUND_MIME_BYTES = 10 * 1024 * 1024; // 10 MB for attached meal/label photos
const MIN_PHOTO_BYTES = 1024; // Ignore tiny 1x1 tracking pixels

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

function walkMimeSection(
  rawSection: string,
  acc: { plainText: string; htmlFallback: string; images: OutreachImageAttachment[] },
): void {
  const splitMatch = rawSection.match(/\r?\n\r?\n/);
  if (!splitMatch || splitMatch.index === undefined) return;

  const headersPart = rawSection.slice(0, splitMatch.index);
  // Unfold RFC 5322 multi-line headers (e.g. boundary wrapped onto next indented line)
  const unfoldedHeaders = headersPart.replace(/\r?\n[ \t]+/g, ' ');
  let bodyPart = rawSection.slice(splitMatch.index + splitMatch[0].length);
  bodyPart = bodyPart.replace(/\r?\n--\s*$/, '');

  const boundaryMatch = unfoldedHeaders.match(/boundary=(?:"([^"]+)"|([^;\s\r\n]+))/i);
  if (boundaryMatch) {
    const boundary = boundaryMatch[1] || boundaryMatch[2];
    const parts = bodyPart.split(`--${boundary}`);
    // Skip preamble (index 0) and closing "--" epilogue
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (part.startsWith('--')) break;
      walkMimeSection(part.replace(/^\r?\n/, ''), acc);
    }
    return;
  }

  const ctMatch = unfoldedHeaders.match(/Content-Type:\s*([a-z0-9.+-]+\/[a-z0-9.+-]+)/i);
  const contentType = (ctMatch?.[1] || 'text/plain').toLowerCase();
  const isBase64 = /Content-Transfer-Encoding:\s*base64/i.test(unfoldedHeaders);
  const isQP = /Content-Transfer-Encoding:\s*quoted-printable/i.test(unfoldedHeaders);

  if (contentType.startsWith('image/') && isBase64 && acc.images.length < 3) {
    const cleanB64 = bodyPart.replace(/\s+/g, '');
    const approxBytes = Math.floor((cleanB64.length * 3) / 4);
    if (approxBytes >= MIN_PHOTO_BYTES) {
      acc.images.push({
        contentType,
        dataUri: `data:${contentType};base64,${cleanB64}`,
      });
    }
    return;
  }

  if (contentType === 'text/plain' || contentType === 'text/html') {
    let decoded = bodyPart;
    if (isBase64) {
      try {
        decoded = Buffer.from(bodyPart.replace(/\s+/g, ''), 'base64').toString('utf8');
      } catch {
        // Keep raw fallback
      }
    } else if (isQP) {
      decoded = decodeQuotedPrintable(bodyPart);
    }

    if (contentType === 'text/plain' && !acc.plainText) {
      acc.plainText = decoded.trim();
    } else if (contentType === 'text/html' && !acc.htmlFallback) {
      acc.htmlFallback = stripHtmlTags(decoded).trim();
    }
  }
}

/**
 * Extracts plain-text reply AND up to 3 attached/inline meal or nutrition-label photos
 * from a raw RFC 5322 / MIME email buffer.
 */
export function extractEmailReplyPartsFromRawMime(rawBuffer: Buffer): {
  text: string;
  images: OutreachImageAttachment[];
} {
  const raw = rawBuffer.toString('utf8');
  if (!/\r?\n\r?\n/.test(raw)) {
    return { text: raw.trim(), images: [] };
  }
  const acc = { plainText: '', htmlFallback: '', images: [] as OutreachImageAttachment[] };
  walkMimeSection(raw, acc);
  return {
    text: acc.plainText || acc.htmlFallback,
    images: acc.images,
  };
}

/**
 * Lightweight MIME plain-text extractor preserved for callers & tests needing text only.
 */
export function extractPlainTextFromRawMime(rawBuffer: Buffer): string {
  return extractEmailReplyPartsFromRawMime(rawBuffer).text;
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
          // Phase 1: lightweight header-only check (~500 bytes) before downloading photo bodies
          const meta = await client.fetchOne(
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
            },
            { uid: true },
          );

          if (!meta) continue;

          const headerText = meta.headers ? meta.headers.toString('utf8') : '';
          const headerLower = headerText.toLowerCase();

          // Safety guard 1: strictly require "+cfo@" in To / Delivered-To or envelope.to
          const envToMatch = (meta.envelope?.to ?? []).some((addr) =>
            (addr.address || '').toLowerCase().includes('+cfo@'),
          );
          if (!envToMatch && !headerLower.includes('+cfo@')) {
            continue;
          }

          // Safety guard 2: never re-ingest our own outbound briefings ("From: the CFO <...>")
          const fromEntry = meta.envelope?.from?.[0];
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
          const messageId = messageIdMatch?.[1]?.trim() || meta.envelope?.messageId;
          const receiptId = buildGmailReceiptId(messageId, msgUid);
          const receiptRef = db.doc(`users/${userId}/outreach_actions/${receiptId}`);

          // Idempotency guard: guarantee each Gmail reply is processed at most once
          const existingReceipt = await receiptRef.get();
          if (existingReceipt.exists) {
            continue;
          }

          // Phase 2: fetch full MIME source (up to 10 MB for attached meal/label photos)
          const fullMsg = await client.fetchOne(
            String(msgUid),
            {
              uid: true,
              source: { maxLength: MAX_INBOUND_MIME_BYTES },
            },
            { uid: true },
          );
          if (!fullMsg || !fullMsg.source) continue;

          const { text: plainText, images } = extractEmailReplyPartsFromRawMime(fullMsg.source);
          if (!plainText && images.length === 0) continue;

          // Claim receipt + mark \Seen before LLM/email execution so retries never double-log
          await receiptRef.set({
            source: 'gmail_imap',
            msgUid,
            messageId: messageId ?? null,
            imageCount: images.length,
            createdAt: FieldValue.serverTimestamp(),
          });
          await client.messageFlagsAdd(String(msgUid), ['\\Seen'], { uid: true }).catch(() => {});

          const result = await processOutreachFreeTextMeal({
            uid: userId,
            rawText: plainText,
            photoDataUris: images,
            now: meta.envelope?.date instanceof Date ? meta.envelope.date : undefined,
          });

          await receiptRef.set(
            {
              status: result.status,
              headline: result.headline,
              foodId: result.loggedFoodId ?? null,
            },
            { merge: true },
          );

          const origSubject = (meta.envelope?.subject || '').trim();
          const replySubject = origSubject
            ? /^re:/i.test(origSubject)
              ? origSubject
              : `Re: ${origSubject}`
            : `the CFO: ${result.headline}`;

          await sendOutreachReplyConfirmationEmail({
            to: fromAddr,
            uid: userId,
            subject: replySubject,
            inReplyToMessageId: messageId,
            headline: result.headline,
            detail: result.detail,
            agentReply: result.agentReply,
            lastFoodLine: result.lastFoodLine,
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

/**
 * @fileOverview Stateless 5-minute Discord DM Poller (`minInstances: 0`, zero WebSocket gateway).
 *
 * Polls active Discord DM channels via HTTP v10 REST (`GET /channels/{id}/messages`)
 * for plain-English meal logs and attached meal/nutrition-label photos, evaluates them
 * in 1 pass on `gemini-3.1-flash-lite`, and replies directly in the DM thread.
 */

import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService } from './health-service-admin';
import {
  buildDiscordLedgerStatusPayload,
  openDiscordDmChannel,
  sendDiscordDmReply,
  sendOutreachDiscordDM,
} from './outreach-discord';
import {
  buildLiveUserOutreach,
  executeOutreachQuickAction,
  processOutreachFreeTextMeal,
} from './outreach-service';
import type { OutreachImageAttachment } from '@/ai/flows/outreach-meal-parser';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DISCORD_EPOCH_MS = 1420070400000;

interface DiscordRestAttachment {
  id: string;
  filename?: string;
  content_type?: string;
  size?: number;
  url?: string;
}

interface DiscordRestMessage {
  id: string;
  content?: string;
  timestamp?: string;
  author?: {
    id?: string;
    bot?: boolean;
  };
  attachments?: DiscordRestAttachment[];
}

export function snowflakeToTimestampMs(snowflake: string): number {
  try {
    const idBig = BigInt(snowflake);
    return Number((idBig >> BigInt(22)) + BigInt(DISCORD_EPOCH_MS));
  } catch {
    return 0;
  }
}

export async function fetchDiscordImageAttachments(
  attachments: DiscordRestAttachment[] = [],
): Promise<OutreachImageAttachment[]> {
  const results: OutreachImageAttachment[] = [];
  for (const att of attachments) {
    if (results.length >= 3) break;
    const ct = (att.content_type || '').toLowerCase().split(';')[0].trim();
    if (!ct.startsWith('image/')) continue;
    if ((att.size ?? 0) > MAX_IMAGE_BYTES || !att.url) continue;

    try {
      const res = await fetch(att.url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 512 || buf.length > MAX_IMAGE_BYTES) continue;
      results.push({
        contentType: ct,
        dataUri: `data:${ct};base64,${buf.toString('base64')}`,
      });
    } catch (err) {
      console.warn('[DiscordInbound] Image attachment fetch failed:', err);
    }
  }
  return results;
}

export async function pollDiscordOutreachReplies(): Promise<{
  polledUsers: number;
  processed: number;
  logged: number;
  errors: number;
}> {
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!botToken) {
    return { polledUsers: 0, processed: 0, logged: 0, errors: 0 };
  }

  const db = getAdminFirestore();
  const snap = await db
    .collection('users')
    .where('outreachEnabled', '==', true)
    .get();

  let polledUsers = 0;
  let processed = 0;
  let logged = 0;
  let errors = 0;
  const firstPollCutoffMs = Date.now() - 20 * 60 * 1000;

  for (const userDoc of snap.docs) {
    const uid = userDoc.id;
    const prefs = await adminHealthService.getUserPreferences(db, uid);
    const outreach = prefs?.outreach;
    if (!outreach?.enabled) continue;
    if (outreach.channel !== 'discord' && outreach.channel !== 'both') continue;

    let channelId = outreach.discordChannelId?.trim();
    if (!channelId && outreach.discordUserId) {
      const opened = await openDiscordDmChannel(outreach.discordUserId);
      if (opened.channelId) {
        channelId = opened.channelId;
        await db.doc(`users/${uid}/preferences/settings`).set(
          { outreach: { ...outreach, discordChannelId: channelId } },
          { merge: true },
        );
      }
    }
    if (!channelId) continue;

    polledUsers++;
    const afterQuery = outreach.lastDiscordMessageId
      ? `&after=${encodeURIComponent(outreach.lastDiscordMessageId)}`
      : '';

    try {
      const res = await fetch(
        `${DISCORD_API_BASE}/channels/${channelId}/messages?limit=10${afterQuery}`,
        {
          headers: { Authorization: `Bot ${botToken}` },
        },
      );
      if (!res.ok) continue;

      const rawMessages = (await res.json()) as DiscordRestMessage[];
      if (!Array.isArray(rawMessages) || rawMessages.length === 0) continue;

      // Discord returns newest-first; sort oldest-first so cursor advances monotonically
      const chronological = [...rawMessages].sort((a, b) =>
        BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0,
      );

      let newestMessageId = outreach.lastDiscordMessageId;

      for (const msg of chronological) {
        newestMessageId = msg.id;
        if (msg.author?.bot) continue;

        // On a user's very first poll without a cursor, ignore messages older than 20 minutes
        if (!outreach.lastDiscordMessageId) {
          const msgMs = msg.timestamp
            ? Date.parse(msg.timestamp)
            : snowflakeToTimestampMs(msg.id);
          if (msgMs > 0 && msgMs < firstPollCutoffMs) continue;
        }

        const text = (msg.content || '').trim();
        const hasImageAttachments = (msg.attachments ?? []).some((a) =>
          (a.content_type || '').toLowerCase().startsWith('image/'),
        );
        if (!text && !hasImageAttachments) continue;

        // Founder Mode bridge bypass: messages prefixed with !vibe or !agy are routed to
        // the founder's local Antigravity IDE bridge and ignored by the nutrition logger.
        if (/^!(vibe|agy)\b/i.test(text)) {
          continue;
        }

        // Idempotency receipt per Discord message ID
        const receiptRef = db.doc(`users/${uid}/outreach_actions/discord_mid_${msg.id}`);
        const claimed = await db.runTransaction(async (tx) => {
          const existing = await tx.get(receiptRef);
          if (existing.exists) return false;
          tx.set(receiptRef, {
            type: 'discord_dm_reply',
            discordMessageId: msg.id,
            claimedAtMs: Date.now(),
          });
          return true;
        });
        if (!claimed) continue;

        processed++;

        const lowerText = text.toLowerCase();
        if (!hasImageAttachments && lowerText === '/status') {
          const { composed, todayFoods, yesterdayFoods, proteinGoal } =
            await buildLiveUserOutreach({ uid });
          const statusPayload = buildDiscordLedgerStatusPayload({
            uid,
            composed,
            todayFoods,
            yesterdayFoods,
            proteinGoal,
          });
          await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
            method: 'POST',
            headers: {
              Authorization: `Bot ${botToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(statusPayload),
          });
          continue;
        }

        if (!hasImageAttachments && lowerText.startsWith('/start')) {
          const { composed } = await buildLiveUserOutreach({ uid });
          await sendOutreachDiscordDM({
            uid,
            discordUserId: outreach.discordUserId || '',
            discordChannelId: channelId,
            cadence: outreach.cadence ?? '3x',
            composed,
          });
          continue;
        }

        if (
          !hasImageAttachments &&
          (lowerText === '/stop' ||
            /^(stop|unsubscribe|cancel|quit|off|opt\s*out|remove\s*me)\b[.!]*$/i.test(text) ||
            /\b(don'?t|do\s+not|stop)\s+(message|dm|ping|email|text|contact)(?:ing)?\s+me\b/i.test(
              text,
            ))
        ) {
          const stopRes = await executeOutreachQuickAction({ uid, action: 'unsubscribe' });
          await sendDiscordDmReply({
            channelId,
            replyToMessageId: msg.id,
            headline: stopRes.title,
            agentReply: stopRes.detail,
          });
          continue;
        }

        const cleanedMealText = text.replace(/^\/eat(?:\s+meal:|\s+)/i, '').trim();
        const photoDataUris = hasImageAttachments
          ? await fetchDiscordImageAttachments(msg.attachments)
          : undefined;

        const parseRes = await processOutreachFreeTextMeal({
          uid,
          rawText: cleanedMealText || text,
          photoDataUris,
        });

        if (parseRes.status === 'logged') {
          logged++;
        }

        await sendDiscordDmReply({
          uid,
          channelId,
          replyToMessageId: msg.id,
          headline: parseRes.headline,
          agentReply: parseRes.agentReply || parseRes.detail,
          updatedHeadline: parseRes.updatedHeadline,
          lastFoodLine: parseRes.lastFoodLine,
          loggedFoodId: parseRes.loggedFoodId,
          localDate: parseRes.localDate,
        });
      }

      if (newestMessageId && newestMessageId !== outreach.lastDiscordMessageId) {
        await db.doc(`users/${uid}/preferences/settings`).set(
          {
            outreach: {
              ...outreach,
              discordChannelId: channelId,
              lastDiscordMessageId: newestMessageId,
            },
          },
          { merge: true },
        );
      }
    } catch (err) {
      errors++;
      console.error(`[DiscordInbound] Poll error for ${uid}:`, err);
    }
  }

  return { polledUsers, processed, logged, errors };
}

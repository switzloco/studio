import { personalizedAICoaching } from '@/ai/flows/personalized-ai-coaching';
import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService } from '@/lib/health-service-admin';
import { checkRateLimit } from '@/lib/rate-limit';
import type { ChatMessage } from '@/lib/food-exercise-types';
import { localNowParts, parseChannelCommand } from './format';
import {
  consumeChannelLinkCode,
  deleteChannelLink,
  getChannelLink,
  type ChannelLink,
  type MessagingChannel,
} from './links';

/**
 * @fileOverview Channel-agnostic inbound message handler. WhatsApp and Discord
 * webhooks (and any future channel) normalize their payloads into an
 * InboundChannelMessage and get back the CFO's reply text — same Genkit flow,
 * same per-day transcript, and same rate limits as the in-app chat, so a meal
 * logged from WhatsApp shows up in the app instantly.
 */

export interface InboundChannelMessage {
  channel: MessagingChannel;
  /** Stable per-channel identity — WhatsApp wa_id (E.164) or Discord user id. */
  externalUserId: string;
  /** Display name from the channel profile, used as a fallback client name. */
  displayName?: string;
  text: string;
}

/** Same sliding history window the in-app chat resends each turn. */
const MAX_SENT_HISTORY = 12;
/** Same guard as the in-app chat — never leave a webhook hanging on the model. */
const AI_TIMEOUT_MS = 60_000;

const CHANNEL_LABEL: Record<MessagingChannel, string> = {
  whatsapp: 'WhatsApp',
  discord: 'Discord',
};

function notLinkedReply(channel: MessagingChannel): string {
  return (
    `This ${CHANNEL_LABEL[channel]} account isn't linked to a CFO Fitness ledger yet.\n\n` +
    `To connect it, open the CFO Fitness app and tell the CFO "link my ${CHANNEL_LABEL[channel]}". ` +
    `You'll get a one-time code — send it back here as:\n\nLINK <code>\n\nCodes expire after 15 minutes.`
  );
}

/**
 * Handles one inbound message from any channel and returns the reply text.
 * Never throws — every failure path returns a sendable message so the person
 * on the other end is never left on read.
 */
export async function handleInboundChannelMessage(msg: InboundChannelMessage): Promise<string> {
  const { channel, externalUserId } = msg;
  try {
    const command = parseChannelCommand(msg.text);

    if (command.kind === 'link') {
      const link = await consumeChannelLinkCode(command.code, channel, externalUserId);
      if (!link) {
        return `That code is invalid or expired. Ask the CFO in the app for a fresh one (codes last 15 minutes), then send LINK <code> again.`;
      }
      const name = link.userName ? `, ${link.userName}` : '';
      return (
        `✅ Linked. Welcome to the ${CHANNEL_LABEL[channel]} desk${name} — your ledger is live here now.\n\n` +
        `Text me meals, workouts, and fasts exactly like you would in the app. Send UNLINK anytime to disconnect.`
      );
    }

    if (command.kind === 'unlink') {
      const removed = await deleteChannelLink(channel, externalUserId);
      return removed
        ? `Disconnected. This ${CHANNEL_LABEL[channel]} account is no longer linked to your ledger.`
        : notLinkedReply(channel);
    }

    const link = await getChannelLink(channel, externalUserId);
    if (!link) return notLinkedReply(channel);

    return await runCoachingTurn(link, msg.text, msg.displayName);
  } catch (error: unknown) {
    const detail = (error as Error)?.message ?? String(error);
    console.error(`[MessagingGateway] ${channel}:${externalUserId} failed:`, detail);
    return `⚠️ The CFO desk hit a system interruption and couldn't process that message. Please try again in a minute.`;
  }
}

async function runCoachingTurn(
  link: ChannelLink,
  text: string,
  displayName?: string,
): Promise<string> {
  const limit = await checkRateLimit(link.userId, 'chat');
  if (!limit.ok) {
    return `Rate limit hit (${limit.scope}). The desk reopens in ${limit.retryAfter}s.`;
  }

  const { localDate, localTime, currentDay } = localNowParts(link.timezoneOffsetMinutes ?? 0);
  const db = getAdminFirestore();

  // Reuse the day's in-app transcript as conversation memory, same window as /api/chat.
  const session = await adminHealthService.getChatSession(db, link.userId, localDate);
  const chatHistory = (session?.messages ?? [])
    .slice(-MAX_SENT_HISTORY)
    .map((m) => ({ role: m.role, content: m.content }));

  const aiPromise = personalizedAICoaching({
    userId: link.userId,
    userName: link.userName || displayName,
    message: text,
    currentDay,
    localDate,
    localTime,
    chatHistory,
  });
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('AI coach timed out.')), AI_TIMEOUT_MS),
  );
  const result = await Promise.race([aiPromise, timeout]);

  // Persist the turn so the app's chat view shows the WhatsApp/Discord exchange.
  const now = Date.now();
  const messages: ChatMessage[] = [
    { role: 'user', content: text, ts: now },
    { role: 'model', content: result.response, ts: now + 1 },
  ];
  try {
    await adminHealthService.appendChatMessages(db, link.userId, localDate, messages);
  } catch (err: unknown) {
    console.error('[MessagingGateway] Failed to persist transcript:', (err as Error)?.message ?? String(err));
  }

  return result.response;
}

import { getAdminFirestore } from '@/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { generateLinkCode, LINK_CODE_TTL_MS } from './format';

/**
 * @fileOverview Firestore store for messaging-channel identity links.
 *
 * Linking flow: the client asks the in-app CFO to "link my WhatsApp", the
 * create_channel_link_code tool mints a one-time code here, and the client
 * sends "LINK <code>" from WhatsApp/Discord. The webhook consumes the code
 * and pins that external identity to the Firebase uid.
 *
 * Collections (Admin-SDK only — Firestore rules deny all client access):
 *   channel_link_codes/{CODE}                 one-time codes, 15-min TTL
 *   channel_links/{channel}:{externalUserId}  external identity → uid
 *   channel_events/{channel}:{eventId}        webhook delivery dedupe
 */

export type MessagingChannel = 'whatsapp' | 'discord';

export interface ChannelLink {
  channel: MessagingChannel;
  externalUserId: string;
  userId: string;
  userName?: string;
  /** Minutes to ADD to UTC for the client's local time (e.g. -480 = PST). */
  timezoneOffsetMinutes?: number;
}

function linkDocId(channel: MessagingChannel, externalUserId: string): string {
  return `${channel}:${externalUserId.replace(/\//g, '_')}`;
}

/** Mints a one-time link code for the given app user. */
export async function createChannelLinkCode(params: {
  userId: string;
  userName?: string;
  timezoneOffsetMinutes?: number;
}): Promise<{ code: string; expiresAt: number }> {
  const db = getAdminFirestore();
  const expiresAt = Date.now() + LINK_CODE_TTL_MS;

  // Codes are 32^6 (~1e9) so a collision is vanishingly rare; retry twice anyway.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateLinkCode();
    try {
      await db.doc(`channel_link_codes/${code}`).create({
        userId: params.userId,
        ...(params.userName ? { userName: params.userName } : {}),
        ...(typeof params.timezoneOffsetMinutes === 'number'
          ? { timezoneOffsetMinutes: params.timezoneOffsetMinutes }
          : {}),
        createdAt: FieldValue.serverTimestamp(),
        expiresAt,
      });
      return { code, expiresAt };
    } catch (err: unknown) {
      if ((err as { code?: number }).code !== 6 /* ALREADY_EXISTS */) throw err;
    }
  }
  throw new Error('Could not allocate a unique link code — try again.');
}

/**
 * Atomically claims a one-time code for an external identity. Returns the
 * created link, or null when the code is unknown, expired, or already used.
 */
export async function consumeChannelLinkCode(
  code: string,
  channel: MessagingChannel,
  externalUserId: string,
): Promise<ChannelLink | null> {
  const db = getAdminFirestore();
  const codeRef = db.doc(`channel_link_codes/${code.toUpperCase()}`);
  const linkRef = db.doc(`channel_links/${linkDocId(channel, externalUserId)}`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(codeRef);
    if (!snap.exists) return null;
    const data = snap.data() as { userId: string; userName?: string; timezoneOffsetMinutes?: number; expiresAt: number; usedAt?: number };
    if (data.usedAt || Date.now() > data.expiresAt) return null;

    const link: ChannelLink = {
      channel,
      externalUserId,
      userId: data.userId,
      ...(data.userName ? { userName: data.userName } : {}),
      ...(typeof data.timezoneOffsetMinutes === 'number'
        ? { timezoneOffsetMinutes: data.timezoneOffsetMinutes }
        : {}),
    };
    tx.update(codeRef, { usedAt: Date.now(), usedBy: linkDocId(channel, externalUserId) });
    tx.set(linkRef, { ...link, linkedAt: FieldValue.serverTimestamp() });
    return link;
  });
}

export async function getChannelLink(
  channel: MessagingChannel,
  externalUserId: string,
): Promise<ChannelLink | null> {
  const db = getAdminFirestore();
  const snap = await db.doc(`channel_links/${linkDocId(channel, externalUserId)}`).get();
  return snap.exists ? (snap.data() as ChannelLink) : null;
}

export async function deleteChannelLink(
  channel: MessagingChannel,
  externalUserId: string,
): Promise<boolean> {
  const db = getAdminFirestore();
  const ref = db.doc(`channel_links/${linkDocId(channel, externalUserId)}`);
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.delete();
  return true;
}

/**
 * Webhook delivery dedupe: returns true exactly once per (channel, eventId).
 * Meta and Discord both redeliver on perceived failure — a duplicate must not
 * double-log a meal. Docs carry an expiresAt for an optional Firestore TTL
 * policy; a failed dedupe write fails OPEN (better a rare duplicate reply
 * than a silently dropped message).
 */
export async function markChannelEventProcessed(
  channel: MessagingChannel,
  eventId: string,
): Promise<boolean> {
  const db = getAdminFirestore();
  const ref = db.doc(`channel_events/${channel}:${eventId.replace(/\//g, '_')}`);
  try {
    await ref.create({ processedAt: FieldValue.serverTimestamp(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000) });
    return true;
  } catch (err: unknown) {
    if ((err as { code?: number }).code === 6 /* ALREADY_EXISTS */) return false;
    console.error('[ChannelLinks] Dedupe write failed:', (err as Error)?.message ?? String(err));
    return true;
  }
}

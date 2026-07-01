import { createPublicKey, verify as cryptoVerify } from 'crypto';
import { NextResponse, after } from 'next/server';
import { handleInboundChannelMessage } from '@/lib/messaging/gateway';
import { markChannelEventProcessed } from '@/lib/messaging/links';
import { splitMessage, DISCORD_MAX_MESSAGE_LEN } from '@/lib/messaging/format';

/**
 * @fileOverview Discord Interactions endpoint — lets clients chat with the CFO
 * via the `/cfo` slash command (works in servers and bot DMs) without running
 * a persistent gateway bot. See docs/MESSAGING_CHANNELS.md for setup.
 *
 * Env: DISCORD_PUBLIC_KEY (ed25519 request verification).
 *
 * Discord requires an ack within 3s, far less than an AI turn — so we return
 * a DEFERRED response immediately and PATCH the real reply in after().
 */

// Interaction / response type constants (developer docs: Interactions).
const PING = 1;
const APPLICATION_COMMAND = 2;
const PONG = 1;
const CHANNEL_MESSAGE_WITH_SOURCE = 4;
const DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE = 5;
const EPHEMERAL = 64;

/** SPKI DER prefix that wraps a raw 32-byte ed25519 key for node:crypto. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

interface DiscordUser {
  id: string;
  username?: string;
  global_name?: string;
}

interface DiscordInteraction {
  id: string;
  type: number;
  token: string;
  application_id: string;
  user?: DiscordUser;              // present in DMs
  member?: { user?: DiscordUser }; // present in servers
  data?: {
    name?: string;
    options?: Array<{ name: string; value?: string }>;
  };
}

function isValidSignature(rawBody: string, signature: string | null, timestamp: string | null, publicKeyHex: string): boolean {
  if (!signature || !timestamp) return false;
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, 'hex')]),
      format: 'der',
      type: 'spki',
    });
    return cryptoVerify(null, Buffer.from(timestamp + rawBody, 'utf8'), key, Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

/** Edits the deferred "thinking…" placeholder, then follows up with any overflow chunks. */
async function sendDiscordReply(interaction: DiscordInteraction, text: string): Promise<void> {
  const base = `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}`;
  const chunks = splitMessage(text, DISCORD_MAX_MESSAGE_LEN);
  if (chunks.length === 0) chunks.push('…');

  for (let i = 0; i < chunks.length; i++) {
    const res = await fetch(i === 0 ? `${base}/messages/@original` : base, {
      method: i === 0 ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: chunks[i] }),
    });
    if (!res.ok) {
      console.error(`[DiscordWebhook] Reply failed (${res.status}):`, await res.text());
      return;
    }
  }
}

export async function POST(req: Request) {
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) {
    return NextResponse.json({ error: 'Discord webhook not configured (DISCORD_PUBLIC_KEY unset).' }, { status: 503 });
  }

  const rawBody = await req.text();
  const signatureOk = isValidSignature(
    rawBody,
    req.headers.get('x-signature-ed25519'),
    req.headers.get('x-signature-timestamp'),
    publicKey,
  );
  if (!signatureOk) {
    return NextResponse.json({ error: 'Invalid request signature' }, { status: 401 });
  }

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (interaction.type === PING) {
    return NextResponse.json({ type: PONG });
  }

  if (interaction.type === APPLICATION_COMMAND && interaction.data?.name === 'cfo') {
    const user = interaction.member?.user ?? interaction.user;
    const text = interaction.data.options?.find((o) => o.name === 'message')?.value;
    if (!user?.id || !text) {
      return NextResponse.json({
        type: CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: 'Usage: `/cfo message: <what you want to tell the CFO>`', flags: EPHEMERAL },
      });
    }

    after(async () => {
      try {
        const firstTime = await markChannelEventProcessed('discord', interaction.id);
        if (!firstTime) return;
        const reply = await handleInboundChannelMessage({
          channel: 'discord',
          externalUserId: user.id,
          displayName: user.global_name ?? user.username,
          text,
        });
        await sendDiscordReply(interaction, reply);
      } catch (err: unknown) {
        console.error('[DiscordWebhook] Interaction processing failed:', (err as Error)?.message ?? String(err));
        await sendDiscordReply(interaction, '⚠️ The CFO desk hit a system interruption. Please try again in a minute.');
      }
    });

    return NextResponse.json({ type: DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE });
  }

  return NextResponse.json({
    type: CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: 'Unsupported interaction.', flags: EPHEMERAL },
  });
}

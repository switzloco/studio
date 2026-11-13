/**
 * @fileOverview Stateless Serverless Discord REST Dispatcher & Ed25519 Interaction Verifier.
 *
 * Designed for `minInstances: 0` on Cloud Run / Firebase App Hosting:
 * - Zero Gateway WebSocket connection required.
 * - Outbound Morning/Midday/Night DMs use Discord's HTTP v10 REST API.
 * - Inbound button clicks, modal meal logs, and slash commands are verified via Ed25519.
 */

import crypto from 'crypto';
import type { ComposedOutreachMessage } from './outreach-composer';
import type { OutreachCadence } from './health-service';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const ED25519_SPKI_PREFIX_HEX = '302a300506032b6570032100';

/**
 * Verifies Discord's `X-Signature-Ed25519` and `X-Signature-Timestamp` headers
 * using Node's native `crypto` module (zero external dependencies).
 */
export function verifyDiscordSignature(params: {
  publicKeyHex?: string;
  signatureHex?: string | null;
  timestamp?: string | null;
  rawBody: string;
}): boolean {
  const { publicKeyHex, signatureHex, timestamp, rawBody } = params;
  if (!publicKeyHex || !signatureHex || !timestamp) return false;
  if (!/^[0-9a-fA-F]{64}$/.test(publicKeyHex.trim())) return false;
  if (!/^[0-9a-fA-F]{128}$/.test(signatureHex.trim())) return false;

  try {
    const spkiDer = Buffer.from(ED25519_SPKI_PREFIX_HEX + publicKeyHex.trim(), 'hex');
    const pubKey = crypto.createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });
    const message = Buffer.from(timestamp + rawBody, 'utf8');
    const sig = Buffer.from(signatureHex.trim(), 'hex');
    return crypto.verify(null, message, pubKey, sig);
  } catch {
    return false;
  }
}

export function buildDiscordOutreachPayload(params: {
  cadence: OutreachCadence;
  composed: ComposedOutreachMessage;
}) {
  const { cadence, composed } = params;
  const colors = {
    good: 0x10b981,
    soon: 0xf59e0b,
    urgent: 0xef4444,
  } as const;

  const windowTitles = {
    morning: 'the CFO · Morning Briefing',
    midday: 'the CFO · Midday Pulse',
    night: 'the CFO · Evening Closeout',
  } as const;

  const quickButtons = composed.quickActions.slice(0, 3).map((btn) => ({
    type: 2, // BUTTON
    style: btn.style === 'primary' ? 1 : 2, // 1 = Primary (Blurple), 2 = Secondary (Grey)
    label: btn.label.slice(0, 80),
    custom_id: `outreach:preset:${btn.action}:${composed.localDate}:${composed.window}`,
  }));

  // Add native popup modal button for free-text meal logging right inside Discord
  quickButtons.push({
    type: 2,
    style: 3, // Success (Green)
    label: 'Log Meal',
    custom_id: `outreach:modal:log_meal:${composed.localDate}`,
  });

  const toggleAction = cadence === '3x' ? 'morning_only' : 'resume_3x';
  const toggleLabel = cadence === '3x' ? 'Morning-Only (1x)' : 'Resume 3x/Day';

  const controlButtons = [
    {
      type: 2,
      style: 2,
      label: toggleLabel,
      custom_id: `outreach:ctrl:${toggleAction}:${composed.localDate}`,
    },
    {
      type: 2,
      style: 2,
      label: 'Pause 7d',
      custom_id: `outreach:ctrl:pause_7d:${composed.localDate}`,
    },
    {
      type: 2,
      style: 4, // Danger (Red)
      label: 'Cancel Pings',
      custom_id: `outreach:ctrl:unsubscribe:${composed.localDate}`,
    },
  ];

  const descriptionParts = [
    composed.autoSunsetBanner ? `_${composed.autoSunsetBanner}_\n` : '',
    composed.body,
    `\n**${composed.lastFoodLine}**\n**What else did you have?** Reply right here in plain English, drop a meal/label photo, or tap **Log Meal** below.`,
  ].filter(Boolean);

  return {
    embeds: [
      {
        author: { name: windowTitles[composed.window] },
        title: composed.headline,
        description: descriptionParts.join('\n'),
        color: colors[composed.statusTone],
        footer: {
          text: `${composed.metricsLine} · Free ($0) · Tap Cancel Pings any time`,
        },
      },
    ],
    components: [
      { type: 1, components: quickButtons },
      { type: 1, components: controlButtons },
    ],
  };
}

/**
 * Opens or retrieves a Discord DM channel ID for `discordUserId`.
 * Note: Discord requires the user and bot to share at least one server (e.g. CFO Fitness Club).
 */
export async function openDiscordDmChannel(discordUserId: string): Promise<{
  channelId?: string;
  error?: string;
}> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    return { error: 'DISCORD_BOT_TOKEN not configured' };
  }

  try {
    const res = await fetch(`${DISCORD_API_BASE}/users/@me/channels`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recipient_id: discordUserId.trim() }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { error: `Discord DM open failed (${res.status}): ${errText.slice(0, 180)}` };
    }

    const data = (await res.json()) as { id?: string };
    return data.id ? { channelId: data.id } : { error: 'No channel ID returned by Discord' };
  } catch (err: any) {
    return { error: err?.message ?? String(err) };
  }
}

/**
 * Sends a Morning/Midday/Night CFO dispatch to a Discord user via cached channel or fresh DM.
 */
export async function sendOutreachDiscordDM(params: {
  discordUserId?: string;
  discordChannelId?: string;
  cadence: OutreachCadence;
  composed: ComposedOutreachMessage;
}): Promise<{ success: boolean; resolvedChannelId?: string; error?: string }> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    console.warn('[OutreachDiscord] DISCORD_BOT_TOKEN not configured — skipping live send.');
    return { success: false, error: 'DISCORD_BOT_TOKEN not configured' };
  }

  let channelId = params.discordChannelId?.trim();
  if (!channelId && params.discordUserId) {
    const opened = await openDiscordDmChannel(params.discordUserId);
    if (!opened.channelId) {
      return { success: false, error: opened.error };
    }
    channelId = opened.channelId;
  }

  if (!channelId) {
    return { success: false, error: 'Missing Discord user or channel ID' };
  }

  const payload = buildDiscordOutreachPayload({
    cadence: params.cadence,
    composed: params.composed,
  });

  try {
    const res = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { success: false, error: `Discord send failed (${res.status}): ${errText.slice(0, 180)}` };
    }

    return { success: true, resolvedChannelId: channelId };
  } catch (err: any) {
    return { success: false, error: err?.message ?? String(err) };
  }
}

/**
 * Sends a lightweight conversational agent reply directly in a Discord DM thread,
 * including a 1-tap [Undo Entry] button whenever a meal was logged.
 */
export async function sendDiscordDmReply(params: {
  channelId: string;
  replyToMessageId?: string;
  headline: string;
  agentReply: string;
  updatedHeadline?: string;
  lastFoodLine?: string;
  loggedFoodId?: string;
  localDate?: string;
}): Promise<{ success: boolean }> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken || !params.channelId) return { success: false };

  const lines = [
    `**${params.headline}**`,
    params.agentReply,
    params.updatedHeadline && params.updatedHeadline !== params.headline
      ? `**Next up:** ${params.updatedHeadline}`
      : '',
    params.lastFoodLine ? `_${params.lastFoodLine}_` : '',
  ].filter(Boolean);

  const components =
    params.loggedFoodId && params.localDate
      ? [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 2,
                label: 'Undo Entry',
                custom_id: `outreach:undo:${params.loggedFoodId}:${params.localDate}`,
              },
            ],
          },
        ]
      : undefined;

  try {
    const res = await fetch(`${DISCORD_API_BASE}/channels/${params.channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: lines.join('\n'),
        ...(params.replyToMessageId
          ? {
              message_reference: {
                message_id: params.replyToMessageId,
                fail_if_not_exists: false,
              },
            }
          : {}),
        ...(components ? { components } : {}),
      }),
    });
    return { success: res.ok };
  } catch {
    return { success: false };
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminFirestore } from '@/firebase/admin';
import { adminHealthService } from '@/lib/health-service-admin';
import {
  openDiscordDmChannel,
  sendOutreachDiscordDM,
  verifyDiscordSignature,
} from '@/lib/outreach-discord';
import { fetchDiscordImageAttachments } from '@/lib/outreach-discord-inbound';
import type { OutreachActionType } from '@/lib/outreach-auth';
import type { OutreachWindow } from '@/lib/health-service';
import {
  buildLiveUserOutreach,
  executeOutreachQuickAction,
  processOutreachFreeTextMeal,
  saveUserOutreachSettings,
} from '@/lib/outreach-service';

/**
 * @fileOverview Stateless Discord HTTP Interactions Endpoint (`POST /api/discord/interactions`).
 *
 * Works with `minInstances: 0` on Cloud Run — zero persistent Gateway WebSocket required.
 * Supports:
 *   - Type 1: PING verification
 *   - Type 2: Slash commands (`/start`, `/status`, `/eat`, `/stop`)
 *   - Type 3: Message component buttons (1-tap presets, `[Log Meal]` modal trigger, Pause/Cancel)
 *   - Type 5: Modal submit (`outreach:modal_submit:log_meal`)
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const EPHEMERAL_FLAG = 64;

async function resolveOrCreateUidForDiscordUser(
  discordUserId: string,
  channelId?: string,
  autoCreate = false,
): Promise<string | null> {
  const db = getAdminFirestore();
  const snap = await db
    .collection('users')
    .where('outreachDiscordUserId', '==', discordUserId)
    .limit(1)
    .get();

  if (!snap.empty) {
    return snap.docs[0].id;
  }

  if (!autoCreate) return null;

  const syntheticUid = `discord_${discordUserId}`;
  await saveUserOutreachSettings({
    uid: syntheticUid,
    outreach: {
      enabled: true,
      channel: 'discord',
      cadence: '3x',
      discordUserId,
      discordChannelId: channelId,
      timezone: 'America/Los_Angeles',
      morningHour: 7,
      middayHour: 12,
      nightHour: 19,
    },
  });
  return syntheticUid;
}

export async function POST(request: NextRequest) {
  const publicKeyHex = process.env.DISCORD_PUBLIC_KEY;
  const rawBody = await request.text();
  const signatureHex = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');

  if (
    !verifyDiscordSignature({
      publicKeyHex,
      signatureHex,
      timestamp,
      rawBody,
    })
  ) {
    return NextResponse.json({ error: 'Invalid request signature' }, { status: 401 });
  }

  let interaction: any;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // 1. Discord Portal PING handshake
  if (interaction.type === 1) {
    return NextResponse.json({ type: 1 });
  }

  const discordUser = interaction.member?.user ?? interaction.user;
  const discordUserId = discordUser?.id ? String(discordUser.id) : null;
  const channelId = interaction.channel_id ? String(interaction.channel_id) : undefined;

  if (!discordUserId) {
    return NextResponse.json({
      type: 4,
      data: { content: 'Could not identify Discord user.', flags: EPHEMERAL_FLAG },
    });
  }

  // 2. Slash Commands (`type === 2`)
  if (interaction.type === 2) {
    const cmdName = String(interaction.data?.name || '').toLowerCase();
    const options: Array<{ name: string; value: any }> = interaction.data?.options ?? [];
    const getOpt = (name: string) => options.find((o) => o.name === name)?.value;

    if (cmdName === 'start') {
      const tz = String(getOpt('timezone') || 'America/Los_Angeles');
      const emailOpt = String(getOpt('email') || '').trim().toLowerCase();

      let matchedUid: string | null = null;
      let existingChannel: 'email' | 'discord' | 'both' = 'discord';
      if (emailOpt && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailOpt)) {
        const db = getAdminFirestore();
        const byOutreachEmail = await db
          .collection('users')
          .where('outreachEmail', '==', emailOpt)
          .limit(1)
          .get();
        if (!byOutreachEmail.empty) {
          matchedUid = byOutreachEmail.docs[0].id;
        } else {
          const authUser = await getAdminAuth().getUserByEmail(emailOpt).catch(() => null);
          if (authUser?.uid) matchedUid = authUser.uid;
        }
        if (matchedUid) {
          const prefs = await adminHealthService.getUserPreferences(db, matchedUid);
          if (prefs?.outreach?.enabled && prefs.outreach.email) {
            existingChannel = 'both';
          }
        }
      }

      const dmOpened = await openDiscordDmChannel(discordUserId);
      const dmChannelId = dmOpened.channelId || channelId;

      const uid =
        matchedUid || (await resolveOrCreateUidForDiscordUser(discordUserId, dmChannelId, true))!;
      await saveUserOutreachSettings({
        uid,
        outreach: {
          enabled: true,
          channel: existingChannel,
          cadence: '3x',
          ...(emailOpt ? { email: emailOpt } : {}),
          discordUserId,
          discordChannelId: dmChannelId,
          timezone: tz,
        },
      });

      const { composed } = await buildLiveUserOutreach({ uid });
      await sendOutreachDiscordDM({
        discordUserId,
        discordChannelId: dmChannelId,
        cadence: '3x',
        composed,
      }).catch(() => null);

      const linkedNote = matchedUid ? ` · Linked to \`${emailOpt}\`` : '';
      return NextResponse.json({
        type: 4,
        data: {
          content: `**3x/Day Free CFO Briefings Enabled** (${tz}${linkedNote})\n**${composed.headline}**\n${composed.body}\n\n**${composed.lastFoodLine}**\nSent your interactive Eat-By Briefing card to your DMs — reply right in DM with plain English or a meal/label photo, or use \`/eat\`.\n_Free forever ($0). Run \`/stop\` or tap Cancel Pings any time._`,
          flags: EPHEMERAL_FLAG,
        },
      });
    }

    const uid = await resolveOrCreateUidForDiscordUser(discordUserId, channelId, false);
    if (!uid) {
      return NextResponse.json({
        type: 4,
        data: {
          content: 'Run `/start` first (or link your Discord ID at cfofitness.app) to activate free 3x/day briefings.',
          flags: EPHEMERAL_FLAG,
        },
      });
    }

    if (cmdName === 'stop') {
      const res = await executeOutreachQuickAction({ uid, action: 'unsubscribe' });
      return NextResponse.json({
        type: 4,
        data: { content: `**${res.title}** — ${res.detail}`, flags: EPHEMERAL_FLAG },
      });
    }

    if (cmdName === 'status') {
      const { composed } = await buildLiveUserOutreach({ uid });
      return NextResponse.json({
        type: 4,
        data: {
          content: `**${composed.headline}**\n${composed.body}\n\`${composed.metricsLine}\``,
          flags: EPHEMERAL_FLAG,
        },
      });
    }

    if (cmdName === 'eat') {
      const mealText = String(getOpt('meal') || '').trim();
      const photoAttachmentId = getOpt('photo') ? String(getOpt('photo')) : null;
      const resolvedAttachments = interaction.data?.resolved?.attachments ?? {};
      const rawAtt = photoAttachmentId ? resolvedAttachments[photoAttachmentId] : null;
      const photoDataUris = rawAtt
        ? await fetchDiscordImageAttachments([rawAtt])
        : undefined;

      if (!mealText && (!photoDataUris || photoDataUris.length === 0)) {
        return NextResponse.json({
          type: 4,
          data: {
            content: 'Include `meal:` text or attach a `photo:` so I can put it on your ledger.',
            flags: EPHEMERAL_FLAG,
          },
        });
      }

      const parsedRes = await processOutreachFreeTextMeal({
        uid,
        rawText: mealText,
        photoDataUris,
      });
      return NextResponse.json({
        type: 4,
        data: {
          content: `**${parsedRes.headline}**\n${parsedRes.agentReply || parsedRes.detail}${parsedRes.lastFoodLine ? `\n_${parsedRes.lastFoodLine}_` : ''}`,
          flags: EPHEMERAL_FLAG,
        },
      });
    }
  }

  // 3. Button Clicks (`type === 3`)
  if (interaction.type === 3) {
    const customId = String(interaction.data?.custom_id || '');
    const parts = customId.split(':');

    // Open native Discord modal popup for free-text meal entry
    if (parts[0] === 'outreach' && parts[1] === 'modal' && parts[2] === 'log_meal') {
      return NextResponse.json({
        type: 9, // MODAL
        data: {
          custom_id: 'outreach:modal_submit:log_meal',
          title: 'Log Meal to CFO Ledger',
          components: [
            {
              type: 1,
              components: [
                {
                  type: 4, // TEXT_INPUT
                  custom_id: 'meal_description',
                  label: 'What did you eat or drink?',
                  style: 2, // Paragraph
                  placeholder: 'e.g. 3 eggs, sourdough toast, black coffee',
                  required: true,
                  max_length: 400,
                },
              ],
            },
          ],
        },
      });
    }

    const uid = await resolveOrCreateUidForDiscordUser(discordUserId, channelId, true);
    if (!uid) {
      return NextResponse.json({
        type: 4,
        data: { content: 'Account not found.', flags: EPHEMERAL_FLAG },
      });
    }

    if (parts[0] === 'outreach' && parts[1] === 'undo') {
      const foodId = parts[2] || undefined;
      const date = parts[3] || undefined;
      const res = await executeOutreachQuickAction({
        uid,
        action: 'undo_food',
        foodId,
        date,
      });
      const clockNote = res.updatedHeadline ? `\n\n**${res.updatedHeadline}**\n${res.updatedBody ?? ''}` : '';
      return NextResponse.json({
        type: 4,
        data: {
          content: `**${res.title}** — ${res.detail}${clockNote}`,
          flags: EPHEMERAL_FLAG,
        },
      });
    }

    if (parts[0] === 'outreach' && (parts[1] === 'preset' || parts[1] === 'ctrl')) {
      const action = parts[2] as OutreachActionType;
      const date = parts[3] || undefined;
      const window = (parts[4] as OutreachWindow | undefined) || undefined;

      const res = await executeOutreachQuickAction({ uid, action, date, window });
      const clockNote = res.updatedHeadline ? `\n\n**${res.updatedHeadline}**\n${res.updatedBody ?? ''}` : '';
      return NextResponse.json({
        type: 4,
        data: {
          content: `**${res.title}** — ${res.detail}${clockNote}`,
          flags: EPHEMERAL_FLAG,
        },
      });
    }
  }

  // 4. Modal Submit (`type === 5`)
  if (interaction.type === 5 && interaction.data?.custom_id === 'outreach:modal_submit:log_meal') {
    const uid = await resolveOrCreateUidForDiscordUser(discordUserId, channelId, true);
    const rows = interaction.data?.components ?? [];
    const rawMeal = String(rows?.[0]?.components?.[0]?.value || '').trim();

    if (!uid || !rawMeal) {
      return NextResponse.json({
        type: 4,
        data: { content: 'Please enter what you ate.', flags: EPHEMERAL_FLAG },
      });
    }

    const res = await processOutreachFreeTextMeal({ uid, rawText: rawMeal });
    return NextResponse.json({
      type: 4,
      data: {
        content: `**${res.headline}**\n${res.detail}`,
        flags: EPHEMERAL_FLAG,
      },
    });
  }

  return NextResponse.json({
    type: 4,
    data: { content: 'Unsupported interaction.', flags: EPHEMERAL_FLAG },
  });
}

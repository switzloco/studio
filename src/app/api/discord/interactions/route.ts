import { after, NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminFirestore } from '@/firebase/admin';
import { adminHealthService } from '@/lib/health-service-admin';
import {
  buildDiscordLedgerStatusPayload,
  openDiscordDmChannel,
  sendOutreachDiscordDM,
  verifyDiscordSignature,
} from '@/lib/outreach-discord';
import { buildOutreachActionUrl } from '@/lib/outreach-email';
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

function buildLogMealModalResponse() {
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
              label: "What did you eat? (Today or 'Last night...')",
              style: 2, // Paragraph
              placeholder: 'e.g. Chickpea curry & rice (or "Last night at 9pm: 2 slices pizza")',
              required: true,
              max_length: 400,
            },
          ],
        },
      ],
    },
  });
}

async function findRecentUnloggedDmMessage(params: {
  uid: string;
  discordUserId: string;
  channelId?: string;
}): Promise<{ id: string; text: string; attachments: any[] } | null> {
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!botToken || !params.channelId) return null;

  try {
    const res = await fetch(
      `https://discord.com/api/v10/channels/${params.channelId}/messages?limit=6`,
      {
        headers: { Authorization: `Bot ${botToken}` },
        signal: AbortSignal.timeout(1500),
      },
    );
    if (!res.ok) return null;

    const messages = (await res.json()) as Array<{
      id: string;
      content?: string;
      timestamp?: string;
      author?: { id?: string; bot?: boolean };
      attachments?: any[];
    }>;
    if (!Array.isArray(messages)) return null;

    const cutoffMs = Date.now() - 2 * 60 * 60 * 1000;
    const db = getAdminFirestore();

    for (const msg of messages) {
      if (msg.author?.bot || String(msg.author?.id || '') !== params.discordUserId) continue;
      const msgMs = msg.timestamp ? Date.parse(msg.timestamp) : 0;
      if (msgMs > 0 && msgMs < cutoffMs) continue;

      const text = (msg.content || '').trim();
      const imageAtts = (msg.attachments ?? []).filter((a: any) =>
        String(a?.content_type || '').toLowerCase().startsWith('image/'),
      );
      if (!text && imageAtts.length === 0) continue;
      if (/^!(vibe|agy)\b/i.test(text) || /^\/(start|status|stop|eat)\b/i.test(text)) continue;

      const receiptRef = db.doc(`users/${params.uid}/outreach_actions/discord_mid_${msg.id}`);
      const claimed = await db.runTransaction(async (tx) => {
        const snap = await tx.get(receiptRef);
        if (snap.exists) return false;
        tx.set(receiptRef, {
          type: 'discord_dm_reply',
          discordMessageId: msg.id,
          claimedAtMs: Date.now(),
        });
        return true;
      });

      if (claimed) {
        return { id: msg.id, text, attachments: imageAtts };
      }
      // If the newest user message already has a receipt, don't reach further back into already-handled history
      break;
    }
  } catch {
    // Non-fatal: fall back to opening modal
  }
  return null;
}

async function resolveOrCreateUidForDiscordUser(
  discordUserId: string,
  channelId?: string,
  autoCreate = false,
  discordDisplayName?: string,
): Promise<string | null> {
  const db = getAdminFirestore();
  const snap = await db
    .collection('users')
    .where('outreachDiscordUserId', '==', discordUserId)
    .limit(5)
    .get();

  // Always prefer a real Firebase Auth UID over a synthetic `discord_<id>` document
  const realDoc = snap.docs.find((d) => !d.id.startsWith('discord_'));
  if (realDoc) {
    return realDoc.id;
  }

  // Self-healing fallback: check if a real user's preferences/settings owns this discordUserId
  // (e.g. if a client write ever cleared root mirror fields)
  try {
    const founderEmail = 'nicholas.switzer@gmail.com';
    const founderAuth = await getAdminAuth().getUserByEmail(founderEmail).catch(() => null);
    if (founderAuth?.uid) {
      const founderPrefs = await adminHealthService.getUserPreferences(db, founderAuth.uid);
      if (founderPrefs?.outreach?.discordUserId === discordUserId) {
        await adminHealthService.updateHealthData(db, founderAuth.uid, {
          outreachEnabled: Boolean(founderPrefs.outreach.enabled),
          outreachDiscordUserId: discordUserId,
          ...(founderPrefs.outreach.email ? { outreachEmail: founderPrefs.outreach.email } : {}),
        });
        return founderAuth.uid;
      }
    }
  } catch {
    // Non-fatal fallback
  }

  if (!snap.empty) {
    const existingUid = snap.docs[0].id;
    if (discordDisplayName && !snap.docs[0].data()?.displayName) {
      await db.doc(`users/${existingUid}`).set({ displayName: discordDisplayName }, { merge: true }).catch(() => null);
    }
    return existingUid;
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
  if (discordDisplayName) {
    await db.doc(`users/${syntheticUid}`).set({ displayName: discordDisplayName }, { merge: true }).catch(() => null);
  }
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
  const discordDisplayName =
    String(interaction.member?.nick || discordUser?.global_name || discordUser?.username || '').trim() || undefined;
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
      const morningHour = getOpt('morning_hour') !== undefined ? Number(getOpt('morning_hour')) : undefined;
      const middayHour = getOpt('midday_hour') !== undefined ? Number(getOpt('midday_hour')) : undefined;
      const nightHour = getOpt('night_hour') !== undefined ? Number(getOpt('night_hour')) : undefined;

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
        matchedUid || (await resolveOrCreateUidForDiscordUser(discordUserId, dmChannelId, true, discordDisplayName))!;
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
          ...(morningHour !== undefined ? { morningHour } : {}),
          ...(middayHour !== undefined ? { middayHour } : {}),
          ...(nightHour !== undefined ? { nightHour } : {}),
        },
      });

      const { composed } = await buildLiveUserOutreach({ uid });
      await sendOutreachDiscordDM({
        uid,
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

    const uid = await resolveOrCreateUidForDiscordUser(
      discordUserId,
      channelId,
      cmdName === 'eat' || cmdName === 'status',
      discordDisplayName,
    );
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
      const { composed, todayFoods, yesterdayFoods, proteinGoal } = await buildLiveUserOutreach({ uid });
      const statusPayload = buildDiscordLedgerStatusPayload({
        uid,
        composed,
        todayFoods,
        yesterdayFoods,
        proteinGoal,
      });
      return NextResponse.json({
        type: 4,
        data: {
          ...statusPayload,
          flags: EPHEMERAL_FLAG,
        },
      });
    }

    if (cmdName === 'eat') {
      let mealText = String(getOpt('meal') || '').trim();
      const photoAttachmentId = getOpt('photo') ? String(getOpt('photo')) : null;
      const resolvedAttachments = interaction.data?.resolved?.attachments ?? {};
      const rawAtt = photoAttachmentId ? resolvedAttachments[photoAttachmentId] : null;
      let fallbackAttachments: any[] = rawAtt ? [rawAtt] : [];
      let claimedDmMessageId: string | null = null;

      if (!mealText && fallbackAttachments.length === 0) {
        const recentDm = await findRecentUnloggedDmMessage({
          uid,
          discordUserId,
          channelId,
        });
        if (recentDm) {
          mealText = recentDm.text;
          fallbackAttachments = recentDm.attachments;
          claimedDmMessageId = recentDm.id;
        } else {
          return buildLogMealModalResponse();
        }
      }

      const appId = String(interaction.application_id || process.env.NEXT_PUBLIC_DISCORD_APP_ID || '1570868560065077420');
      const interactionToken = String(interaction.token || '');

      after(async () => {
        try {
          if (claimedDmMessageId) {
            const db = getAdminFirestore();
            const prefs = await adminHealthService.getUserPreferences(db, uid);
            await db.doc(`users/${uid}/preferences/settings`).set(
              {
                outreach: {
                  ...(prefs?.outreach ?? {}),
                  lastDiscordMessageId: claimedDmMessageId,
                },
              },
              { merge: true },
            );
          }
          const photoDataUris =
            fallbackAttachments.length > 0
              ? await fetchDiscordImageAttachments(fallbackAttachments)
              : undefined;
          const parsedRes = await processOutreachFreeTextMeal({
            uid,
            rawText: mealText,
            photoDataUris,
          });
          const rowButtons: Array<Record<string, unknown>> = [];
          if (parsedRes.loggedFoodId && parsedRes.localDate) {
            rowButtons.push({
              type: 2,
              style: 2,
              label: 'Undo Entry',
              custom_id: `outreach:undo:${parsedRes.loggedFoodId}:${parsedRes.localDate}`,
            });
          }
          rowButtons.push({
            type: 2,
            style: 5,
            label: 'View Ledger',
            url: buildOutreachActionUrl({ uid, action: 'view_ledger' }),
          });
          const macroBadge = parsedRes.loggedMacros
            ? ` (**+${parsedRes.loggedMacros.calories} kcal · ${parsedRes.loggedMacros.proteinG}g protein · ${parsedRes.loggedMacros.carbsG}g carbs · ${parsedRes.loggedMacros.fatG}g fat**)`
            : '';
          const clockUpdateLine =
            parsedRes.updatedHeadline && parsedRes.updatedHeadline !== parsedRes.headline
              ? `\n**Updated Clock:** ${parsedRes.updatedHeadline} — ${parsedRes.updatedBody || ''}${parsedRes.metricsLine ? `\n\`${parsedRes.metricsLine}\`` : ''}`
              : '';
          await fetch(
            `https://discord.com/api/v10/webhooks/${appId}/${interactionToken}/messages/@original`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                content: `**${parsedRes.headline}**${macroBadge}\n${parsedRes.agentReply || parsedRes.detail}${clockUpdateLine}${parsedRes.lastFoodLine ? `\n_${parsedRes.lastFoodLine}_` : ''}`,
                components: [{ type: 1, components: rowButtons }],
              }),
            },
          );
        } catch (err) {
          console.error('[DiscordInteractions] /eat deferred error:', err);
        }
      });

      return NextResponse.json({
        type: 5, // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE (prevents Discord 3.0s timeout on LLM parse)
        data: { flags: EPHEMERAL_FLAG },
      });
    }
  }

  // 3. Button Clicks (`type === 3`)
  if (interaction.type === 3) {
    const customId = String(interaction.data?.custom_id || '');
    const parts = customId.split(':');

    // Open native Discord modal popup for free-text meal entry
    if (parts[0] === 'outreach' && parts[1] === 'modal' && parts[2] === 'log_meal') {
      return buildLogMealModalResponse();
    }

    // 1-Tap Server Enroll Button (`outreach:enroll`)
    if (parts[0] === 'outreach' && parts[1] === 'enroll') {
      const tz = parts[2] || 'America/New_York';
      const dmOpened = await openDiscordDmChannel(discordUserId);
      const dmChannelId = dmOpened.channelId || channelId;
      const uid = (await resolveOrCreateUidForDiscordUser(
        discordUserId,
        dmChannelId,
        true,
        discordDisplayName,
      ))!;
      await saveUserOutreachSettings({
        uid,
        outreach: {
          enabled: true,
          channel: 'discord',
          cadence: '3x',
          discordUserId,
          discordChannelId: dmChannelId,
          timezone: tz,
          morningHour: 7,
          middayHour: 12,
          nightHour: 19,
        },
      });
      const { composed } = await buildLiveUserOutreach({ uid });
      await sendOutreachDiscordDM({
        uid,
        discordUserId,
        discordChannelId: dmChannelId,
        cadence: '3x',
        composed,
      }).catch(() => null);
      const ledgerUrl = buildOutreachActionUrl({ uid, action: 'view_ledger' });
      return NextResponse.json({
        type: 4,
        data: {
          content: `**You're Enrolled${discordDisplayName ? `, ${discordDisplayName}` : ''}! ($0)**\nJust sent your first live Eat-By Briefing to your **Discord DMs**.\n\n**Right Now:** ${composed.headline}\n${composed.body}\n\n• Reply right in our DM in plain English (e.g. _"3 eggs and toast"_) or drop a meal photo.\n• Or use \`/eat\` and \`/status\` anytime.`,
          flags: EPHEMERAL_FLAG,
          components: [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  style: 5,
                  label: 'Open Live Web Ledger',
                  url: ledgerUrl,
                },
              ],
            },
          ],
        },
      });
    }

    const uid = await resolveOrCreateUidForDiscordUser(discordUserId, channelId, true, discordDisplayName);
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
    const uid = await resolveOrCreateUidForDiscordUser(discordUserId, channelId, true, discordDisplayName);
    const rows = interaction.data?.components ?? [];
    const rawMeal = String(rows?.[0]?.components?.[0]?.value || '').trim();

    if (!uid || !rawMeal) {
      return NextResponse.json({
        type: 4,
        data: { content: 'Please enter what you ate.', flags: EPHEMERAL_FLAG },
      });
    }

    const appId = String(interaction.application_id || process.env.NEXT_PUBLIC_DISCORD_APP_ID || '1570868560065077420');
    const interactionToken = String(interaction.token || '');

    after(async () => {
      try {
        const res = await processOutreachFreeTextMeal({ uid, rawText: rawMeal });
        const rowButtons: Array<Record<string, unknown>> = [];
        if (res.loggedFoodId && res.localDate) {
          rowButtons.push({
            type: 2,
            style: 2,
            label: 'Undo Entry',
            custom_id: `outreach:undo:${res.loggedFoodId}:${res.localDate}`,
          });
        }
        rowButtons.push({
          type: 2,
          style: 5,
          label: 'View Ledger',
          url: buildOutreachActionUrl({ uid, action: 'view_ledger' }),
        });
        const macroBadge = res.loggedMacros
          ? ` (**+${res.loggedMacros.calories} kcal · ${res.loggedMacros.proteinG}g protein · ${res.loggedMacros.carbsG}g carbs · ${res.loggedMacros.fatG}g fat**)`
          : '';
        const clockUpdateLine =
          res.updatedHeadline && res.updatedHeadline !== res.headline
            ? `\n**Updated Clock:** ${res.updatedHeadline} — ${res.updatedBody || ''}${res.metricsLine ? `\n\`${res.metricsLine}\`` : ''}`
            : '';
        await fetch(
          `https://discord.com/api/v10/webhooks/${appId}/${interactionToken}/messages/@original`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: `**${res.headline}**${macroBadge}\n${res.agentReply || res.detail}${clockUpdateLine}${res.lastFoodLine ? `\n_${res.lastFoodLine}_` : ''}`,
              components: [{ type: 1, components: rowButtons }],
            }),
          },
        );
      } catch (err) {
        console.error('[DiscordInteractions] Modal submit deferred error:', err);
      }
    });

    return NextResponse.json({
      type: 5, // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
      data: { flags: EPHEMERAL_FLAG },
    });
  }

  return NextResponse.json({
    type: 4,
    data: { content: 'Unsupported interaction.', flags: EPHEMERAL_FLAG },
  });
}

'use server';

import crypto from 'crypto';
import { getAdminAuth, getAdminFirestore, verifyIdTokenString } from '@/firebase/admin';
import { adminHealthService } from '@/lib/health-service-admin';
import type { OutreachCadence, OutreachChannel, OutreachWindow } from '@/lib/health-service';
import { normalizeTimezone, resolveLocalClock } from '@/lib/outreach-auth';
import {
  buildLiveUserOutreach,
  dispatchOutreachForUser,
  saveUserOutreachSettings,
} from '@/lib/outreach-service';

function currentWindowForHour(hour: number): OutreachWindow {
  if (hour < 11) return 'morning';
  if (hour < 17) return 'midday';
  return 'night';
}

export async function enrollPublicOutreachAction(data: {
  channel: OutreachChannel;
  email?: string;
  discordUserId?: string;
  weightLbs?: number;
  cadence?: OutreachCadence;
  timezone?: string;
  morningHour?: number;
  middayHour?: number;
  nightHour?: number;
}): Promise<{
  success: boolean;
  error?: string;
  headline?: string;
  body?: string;
  deliveredNow?: boolean;
}> {
  try {
    const channel: OutreachChannel = data.channel || 'email';
    const email = (data.email || '').trim().toLowerCase();
    const discordUserId = (data.discordUserId || '').trim();

    if ((channel === 'email' || channel === 'both') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { success: false, error: 'Please enter a valid email address.' };
    }

    if ((channel === 'discord' || channel === 'both') && !/^\d{15,22}$/.test(discordUserId)) {
      return {
        success: false,
        error: 'Please enter your numeric Discord User ID (17–20 digits, e.g. 123456789012345678).',
      };
    }

    const db = getAdminFirestore();
    let uid: string | null = null;

    if (email) {
      const existingByEmail = await db
        .collection('users')
        .where('outreachEmail', '==', email)
        .limit(1)
        .get();
      if (!existingByEmail.empty) {
        uid = existingByEmail.docs[0].id;
      } else {
        const authUser = await getAdminAuth().getUserByEmail(email).catch(() => null);
        if (authUser?.uid) {
          uid = authUser.uid;
        }
      }
    }

    if (!uid && discordUserId) {
      const existingByDiscord = await db
        .collection('users')
        .where('outreachDiscordUserId', '==', discordUserId)
        .limit(1)
        .get();
      if (!existingByDiscord.empty) {
        uid = existingByDiscord.docs[0].id;
      }
    }

    if (!uid) {
      const keySource = email || `discord:${discordUserId}`;
      const shortHash = crypto.createHash('sha256').update(keySource).digest('hex').slice(0, 20);
      uid = `outreach_${shortHash}`;
      await adminHealthService.getHealthSummary(db, uid);
    }

    const weightLbs = Number(data.weightLbs || 0);
    const weightKg = weightLbs >= 80 && weightLbs <= 500 ? weightLbs / 2.20462 : undefined;
    const proteinGoal =
      weightLbs >= 80 && weightLbs <= 500
        ? Math.min(240, Math.max(110, Math.round(weightLbs * 0.85)))
        : undefined;
    const timezone = normalizeTimezone(data.timezone);

    await saveUserOutreachSettings({
      uid,
      outreach: {
        enabled: true,
        channel,
        cadence: data.cadence ?? '3x',
        email: email || undefined,
        discordUserId: discordUserId || undefined,
        timezone,
        ...(data.morningHour != null
          ? { morningHour: Math.max(4, Math.min(11, Math.round(data.morningHour))) }
          : {}),
        ...(data.middayHour != null
          ? { middayHour: Math.max(11, Math.min(16, Math.round(data.middayHour))) }
          : {}),
        ...(data.nightHour != null
          ? { nightHour: Math.max(17, Math.min(22, Math.round(data.nightHour))) }
          : {}),
      },
      weightKg,
      proteinGoal,
    });

    const clock = resolveLocalClock(new Date(), timezone);
    const windowNow = currentWindowForHour(clock.hour);
    const dispatchRes = await dispatchOutreachForUser({
      uid,
      window: windowNow,
      force: true,
      isWelcome: true,
    });

    const composed =
      dispatchRes.composed ?? (await buildLiveUserOutreach({ uid, window: windowNow })).composed;

    return {
      success: true,
      headline: composed.headline,
      body: composed.body,
      deliveredNow: dispatchRes.status === 'sent',
    };
  } catch (err: any) {
    console.error('[enrollPublicOutreachAction] Error:', err);
    return {
      success: false,
      error: err?.message || 'Could not activate briefings right now.',
    };
  }
}

export async function updateMyOutreachSettingsAction(
  idToken: string,
  settings: {
    enabled: boolean;
    channel: OutreachChannel;
    cadence: OutreachCadence;
    email?: string;
    discordUserId?: string;
    timezone: string;
    morningHour?: number;
    middayHour?: number;
    nightHour?: number;
    sendWelcomeNow?: boolean;
  },
): Promise<{
  success: boolean;
  error?: string;
  headline?: string;
  body?: string;
  deliveredNow?: boolean;
}> {
  try {
    const auth = await verifyIdTokenString(idToken);
    if (!auth) {
      return { success: false, error: 'Please sign in again to update settings.' };
    }

    const email = (settings.email || '').trim().toLowerCase();
    const discordUserId = (settings.discordUserId || '').trim();

    if (settings.enabled) {
      if ((settings.channel === 'email' || settings.channel === 'both') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { success: false, error: 'Enter a valid email address for Email briefings.' };
      }
      if ((settings.channel === 'discord' || settings.channel === 'both') && !/^\d{15,22}$/.test(discordUserId)) {
        return { success: false, error: 'Enter your numeric 17–20 digit Discord User ID.' };
      }
    }

    const normalizedTz = normalizeTimezone(settings.timezone);

    await saveUserOutreachSettings({
      uid: auth.uid,
      outreach: {
        enabled: settings.enabled,
        channel: settings.channel,
        cadence: settings.cadence,
        email: email || undefined,
        discordUserId: discordUserId || undefined,
        timezone: normalizedTz,
        ...(settings.morningHour != null
          ? { morningHour: Math.max(4, Math.min(11, Math.round(settings.morningHour))) }
          : {}),
        ...(settings.middayHour != null
          ? { middayHour: Math.max(11, Math.min(16, Math.round(settings.middayHour))) }
          : {}),
        ...(settings.nightHour != null
          ? { nightHour: Math.max(17, Math.min(22, Math.round(settings.nightHour))) }
          : {}),
      },
    });

    if (settings.enabled && settings.sendWelcomeNow) {
      const clock = resolveLocalClock(new Date(), normalizedTz);
      const windowNow = currentWindowForHour(clock.hour);
      const dispatchRes = await dispatchOutreachForUser({
        uid: auth.uid,
        window: windowNow,
        force: true,
        isWelcome: true,
      });
      const composed =
        dispatchRes.composed ??
        (await buildLiveUserOutreach({ uid: auth.uid, window: windowNow })).composed;

      return {
        success: true,
        headline: composed.headline,
        body: composed.body,
        deliveredNow: dispatchRes.status === 'sent',
      };
    }

    return { success: true };
  } catch (err: any) {
    console.error('[updateMyOutreachSettingsAction] Error:', err);
    return { success: false, error: err?.message || 'Failed to save outreach settings.' };
  }
}

export async function sendLiveBriefingNowAction(
  idToken: string,
  windowOverride?: OutreachWindow,
): Promise<{
  success: boolean;
  delivered: boolean;
  headline?: string;
  body?: string;
  error?: string;
}> {
  try {
    const auth = await verifyIdTokenString(idToken);
    if (!auth) {
      return { success: false, delivered: false, error: 'Unauthorized.' };
    }

    const db = getAdminFirestore();
    const prefs = await adminHealthService.getUserPreferences(db, auth.uid);
    const clock = resolveLocalClock(new Date(), prefs?.outreach?.timezone);
    const windowToSend = windowOverride ?? currentWindowForHour(clock.hour);

    const res = await dispatchOutreachForUser({
      uid: auth.uid,
      window: windowToSend,
      force: true,
    });

    const composed =
      res.composed ?? (await buildLiveUserOutreach({ uid: auth.uid, window: windowToSend })).composed;

    return {
      success: true,
      delivered: res.status === 'sent',
      headline: composed.headline,
      body: composed.body,
      ...(res.status !== 'sent' && res.reason ? { error: res.reason } : {}),
    };
  } catch (err: any) {
    console.error('[sendLiveBriefingNowAction] Error:', err);
    return {
      success: false,
      delivered: false,
      error: err?.message || 'Could not dispatch briefing.',
    };
  }
}

/**
 * @fileOverview Server-side orchestration for automated 3x/day CFO Outreach.
 * Coordinates Firestore state, idempotent quick-actions, auto-sunset rules,
 * free-text meal replies (capped on flash-lite), Email (Resend), and Discord REST.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService } from './health-service-admin';
import type {
  OutreachPreferences,
  OutreachWindow,
} from './health-service';
import { inferMealFromTime, type ChatMessage } from './food-exercise-types';
import {
  addIsoDays,
  normalizeTimezone,
  resolveLocalClock,
  type OutreachActionType,
} from './outreach-auth';
import {
  composeOutreachDispatch,
  evaluateAutoSunset,
  type ComposedOutreachMessage,
} from './outreach-composer';
import {
  sendOutreachEmail,
  sendOutreachReplyConfirmationEmail,
  sendOutreachWelcomeEmail,
} from './outreach-email';
import { sendOutreachDiscordDM } from './outreach-discord';
import { parseOutreachMealText } from '@/ai/flows/outreach-meal-parser';
import { backfillScoreHistory } from './score-history-sync';
import { FOUNDER_EMAILS } from './entitlements';

export const MAX_FREE_OUTREACH_PARSES_PER_DAY = 6;

const PRESET_MEALS: Record<
  'protein_40' | 'protein_45_lunch' | 'eggs_breakfast' | 'dinner_standard',
  {
    name: string;
    portionG: number;
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number;
    plantMassG?: number;
  }
> = {
  protein_40: {
    name: 'Lean Protein Pulse (Shake / Isolate)',
    portionG: 350,
    calories: 200,
    proteinG: 40,
    carbsG: 4,
    fatG: 2,
    fiberG: 0,
  },
  protein_45_lunch: {
    name: 'Lean Protein Bowl (Chicken / Greens)',
    portionG: 420,
    calories: 420,
    proteinG: 45,
    carbsG: 28,
    fatG: 12,
    fiberG: 6,
    plantMassG: 200,
  },
  eggs_breakfast: {
    name: '3 Whole Eggs + Egg Whites',
    portionG: 260,
    calories: 260,
    proteinG: 32,
    carbsG: 2,
    fatG: 14,
    fiberG: 0,
  },
  dinner_standard: {
    name: 'High-Protein Dinner (Lean Meat + Veg)',
    portionG: 480,
    calories: 580,
    proteinG: 50,
    carbsG: 38,
    fatG: 22,
    fiberG: 7,
    plantMassG: 240,
  },
};

function currentWindowForHour(hour: number): OutreachWindow {
  if (hour < 11) return 'morning';
  if (hour < 17) return 'midday';
  return 'night';
}

async function appendOutreachTranscript(
  uid: string,
  localDate: string,
  messages: ChatMessage[],
): Promise<void> {
  try {
    const db = getAdminFirestore();
    await adminHealthService.appendChatMessages(db, uid, localDate, messages);
  } catch (err) {
    console.warn('[OutreachService] Non-fatal chat transcript mirror warning:', err);
  }
}

async function refreshDailyFoodCounters(uid: string, localDate: string): Promise<void> {
  const db = getAdminFirestore();
  const allTodayFood = await adminHealthService.queryFoodLog(db, uid, localDate, 60);
  const newProteinTotal = Math.round(allTodayFood.reduce((s, e) => s + (e.proteinG || 0), 0));
  const newCarbsTotal = Math.round(allTodayFood.reduce((s, e) => s + (e.carbsG || 0), 0));
  const newCaloriesTotal = Math.round(allTodayFood.reduce((s, e) => s + (e.calories || 0), 0));
  const newPlantTotal = Math.round(allTodayFood.reduce((s, e) => s + (e.plantMassG || 0), 0));

  const currentHealth = await adminHealthService.getHealthSummary(db, uid);
  if (!currentHealth?.lastActiveDate || localDate >= currentHealth.lastActiveDate) {
    await adminHealthService.updateHealthData(db, uid, {
      dailyProteinG: newProteinTotal,
      dailyCarbsG: newCarbsTotal,
      dailyCaloriesIn: newCaloriesTotal,
      dailyPlantG: newPlantTotal,
      lastActiveDate: localDate,
    });
  }

  await backfillScoreHistory(uid, localDate, 7).catch((err) => {
    console.warn('[OutreachService] Score history backfill non-fatal warning:', err);
  });
}

/**
 * Persists outreach settings on `preferences/settings` and mirrors single-field
 * lookup flags onto `users/{uid}` so cron & webhooks require zero composite indexes.
 */
export async function saveUserOutreachSettings(params: {
  uid: string;
  outreach: Partial<OutreachPreferences> & { enabled: boolean };
  weightKg?: number;
  proteinGoal?: number;
}): Promise<OutreachPreferences> {
  const db = getAdminFirestore();
  const existingPrefs = await adminHealthService.getUserPreferences(db, params.uid);
  const prev = existingPrefs?.outreach;

  const timezone = normalizeTimezone(params.outreach.timezone ?? prev?.timezone);
  const clock = resolveLocalClock(new Date(), timezone);
  const cleanEmail = (params.outreach.email ?? prev?.email ?? '').trim().toLowerCase() || undefined;
  const cleanDiscordId = (params.outreach.discordUserId ?? prev?.discordUserId ?? '').trim() || undefined;

  const merged: OutreachPreferences = adminHealthService.deepClean({
    enabled: params.outreach.enabled,
    channel: params.outreach.channel ?? prev?.channel ?? (cleanDiscordId && !cleanEmail ? 'discord' : 'email'),
    cadence: params.outreach.cadence ?? prev?.cadence ?? '3x',
    email: cleanEmail,
    discordUserId: cleanDiscordId,
    discordChannelId:
      cleanDiscordId === prev?.discordUserId
        ? (params.outreach.discordChannelId ?? prev?.discordChannelId)
        : params.outreach.discordChannelId,
    timezone,
    morningHour: params.outreach.morningHour ?? prev?.morningHour ?? 7,
    middayHour: params.outreach.middayHour ?? prev?.middayHour ?? 12,
    nightHour: params.outreach.nightHour ?? prev?.nightHour ?? 19,
    pausedUntilDate: params.outreach.pausedUntilDate,
    lastInteractionDate: params.outreach.lastInteractionDate ?? prev?.lastInteractionDate ?? clock.localDate,
    lastDispatchedKey: params.outreach.lastDispatchedKey ?? prev?.lastDispatchedKey,
    dailyParseDate: prev?.dailyParseDate,
    dailyParseCount: prev?.dailyParseCount,
  });

  const prefUpdates: Record<string, unknown> = { outreach: merged };
  if (params.proteinGoal && params.proteinGoal >= 50) {
    prefUpdates.targets = {
      ...(existingPrefs?.targets ?? { fatPointsGoal: 3000 }),
      proteinGoal: Math.round(params.proteinGoal),
    };
  }
  if (params.weightKg && params.weightKg >= 30) {
    prefUpdates.profile = {
      ...(existingPrefs?.profile ?? {}),
      weightKg: Math.round(params.weightKg * 10) / 10,
    };
  }

  await db.doc(`users/${params.uid}/preferences/settings`).set(prefUpdates, { merge: true });

  await adminHealthService.updateHealthData(db, params.uid, {
    outreachEnabled: merged.enabled,
    ...(cleanEmail ? { outreachEmail: cleanEmail } : {}),
    ...(cleanDiscordId ? { outreachDiscordUserId: cleanDiscordId } : {}),
    ...(params.weightKg && params.weightKg >= 30 ? { weightKg: Math.round(params.weightKg * 10) / 10 } : {}),
  });

  return merged;
}

/**
 * Loads live user state and composes a deterministic Morning/Midday/Night briefing.
 */
export async function buildLiveUserOutreach(params: {
  uid: string;
  window?: OutreachWindow;
  now?: Date;
  autoSunsetNotice?: 'downshifted_to_morning' | null;
}): Promise<{
  composed: ComposedOutreachMessage;
  outreach: OutreachPreferences | undefined;
  localTime: string;
}> {
  const db = getAdminFirestore();
  const [health, prefs] = await Promise.all([
    adminHealthService.getHealthSummary(db, params.uid),
    adminHealthService.getUserPreferences(db, params.uid),
  ]);

  const outreach = prefs?.outreach;
  const clock = resolveLocalClock(params.now ?? new Date(), outreach?.timezone);
  const yesterdayIso = addIsoDays(clock.localDate, -1);

  const [todayFoods, yesterdayFoods, todayExercises] = await Promise.all([
    adminHealthService.queryFoodLog(db, params.uid, clock.localDate, 50),
    adminHealthService.queryFoodLog(db, params.uid, yesterdayIso, 50),
    adminHealthService.queryExerciseLog(db, params.uid, clock.localDate, 25),
  ]);

  const resolvedWindow = params.window ?? currentWindowForHour(clock.hour);
  const composed = composeOutreachDispatch({
    window: resolvedWindow,
    localDate: clock.localDate,
    hoursElapsed: clock.hoursElapsed,
    health,
    prefs,
    todayFoods,
    yesterdayFoods,
    todayExercises,
    autoSunsetNotice: params.autoSunsetNotice,
  });

  return { composed, outreach, localTime: clock.localTime };
}

/**
 * Dispatches a single Morning/Midday/Night briefing for one user (with idempotency & auto-sunset).
 */
export async function dispatchOutreachForUser(params: {
  uid: string;
  window: OutreachWindow;
  now?: Date;
  force?: boolean;
  isWelcome?: boolean;
}): Promise<{
  status: 'sent' | 'skipped' | 'auto_paused' | 'failed';
  reason?: string;
  composed?: ComposedOutreachMessage;
}> {
  const db = getAdminFirestore();
  const prefs = await adminHealthService.getUserPreferences(db, params.uid);
  const outreach = prefs?.outreach;

  if (!outreach || (!outreach.enabled && !params.force)) {
    return { status: 'skipped', reason: 'outreach_disabled' };
  }

  const clock = resolveLocalClock(params.now ?? new Date(), outreach.timezone);
  const dispatchKey = `${clock.localDate}:${params.window}`;

  if (!params.force) {
    if (outreach.pausedUntilDate && outreach.pausedUntilDate >= clock.localDate) {
      return { status: 'skipped', reason: 'paused' };
    }
    if (outreach.lastDispatchedKey === dispatchKey) {
      return { status: 'skipped', reason: 'already_dispatched' };
    }
  }

  // Evaluate quiet-user auto-sunset policy
  let effectiveCadence = outreach.cadence;
  let autoSunsetNotice: 'downshifted_to_morning' | null = null;

  if (!params.force) {
    const sunset = evaluateAutoSunset({
      localDate: clock.localDate,
      lastInteractionDate: outreach.lastInteractionDate,
      currentCadence: outreach.cadence,
    });

    if (sunset.decision === 'auto_pause') {
      await db.doc(`users/${params.uid}/preferences/settings`).set(
        {
          outreach: {
            ...outreach,
            enabled: false,
            autoPausedAt: new Date().toISOString(),
          },
        },
        { merge: true },
      );
      await adminHealthService.updateHealthData(db, params.uid, { outreachEnabled: false });

      if (outreach.email && (outreach.channel === 'email' || outreach.channel === 'both')) {
        await sendOutreachReplyConfirmationEmail({
          to: outreach.email,
          uid: params.uid,
          subject: 'Paused your daily CFO briefings while you are away',
          headline: 'Paused your CFO briefings for now',
          detail:
            'Since things have been quiet for 10 days, we paused automated pings to keep your inbox clean. Open cfofitness.app any time to turn them right back on.',
        });
      }
      return { status: 'auto_paused', reason: '10_silent_days' };
    }

    if (sunset.decision === 'downshift_to_morning') {
      effectiveCadence = 'morning_only';
      autoSunsetNotice = 'downshifted_to_morning';
      await db.doc(`users/${params.uid}/preferences/settings`).set(
        {
          outreach: {
            ...outreach,
            cadence: 'morning_only',
            autoDownshiftedAt: new Date().toISOString(),
          },
        },
        { merge: true },
      );
    }

    if (effectiveCadence === 'morning_only' && params.window !== 'morning') {
      return { status: 'skipped', reason: 'morning_only_cadence' };
    }
  }

  const { composed } = await buildLiveUserOutreach({
    uid: params.uid,
    window: params.window,
    now: params.now,
    autoSunsetNotice,
  });

  let anySent = false;
  const errors: string[] = [];
  let cachedDiscordChannelId = outreach.discordChannelId;

  if ((outreach.channel === 'email' || outreach.channel === 'both') && outreach.email) {
    const emailRes = params.isWelcome
      ? await sendOutreachWelcomeEmail({
          to: outreach.email,
          uid: params.uid,
          cadence: effectiveCadence,
          timezone: outreach.timezone || 'America/Los_Angeles',
          morningHour: outreach.morningHour,
          middayHour: outreach.middayHour,
          nightHour: outreach.nightHour,
          composed,
        })
      : await sendOutreachEmail({
          to: outreach.email,
          uid: params.uid,
          cadence: effectiveCadence,
          composed,
        });
    if (emailRes.success) anySent = true;
    else if (emailRes.error) errors.push(`email:${emailRes.error}`);
  }

  if (
    (outreach.channel === 'discord' || outreach.channel === 'both') &&
    (outreach.discordUserId || outreach.discordChannelId)
  ) {
    const discordRes = await sendOutreachDiscordDM({
      discordUserId: outreach.discordUserId,
      discordChannelId: outreach.discordChannelId,
      cadence: effectiveCadence,
      composed,
    });
    if (discordRes.success) {
      anySent = true;
      if (discordRes.resolvedChannelId) {
        cachedDiscordChannelId = discordRes.resolvedChannelId;
      }
    } else if (discordRes.error) {
      errors.push(`discord:${discordRes.error}`);
    }
  }

  if (!anySent) {
    return {
      status: 'failed',
      reason: errors.join('; ') || 'No configured delivery channel succeeded',
      composed,
    };
  }

  await db.doc(`users/${params.uid}/preferences/settings`).set(
    {
      outreach: adminHealthService.deepClean({
        ...outreach,
        cadence: effectiveCadence,
        discordChannelId: cachedDiscordChannelId,
        lastDispatchedKey: dispatchKey,
      }),
    },
    { merge: true },
  );

  const windowTitle = params.isWelcome
    ? 'Welcome Briefing'
    : params.window === 'morning'
      ? 'Morning Briefing'
      : params.window === 'midday'
        ? 'Midday Check-In'
        : 'Evening Close';
  const channelBadge =
    outreach.channel === 'both'
      ? 'Email + Discord'
      : outreach.channel === 'discord'
        ? 'Discord'
        : 'Email';

  await appendOutreachTranscript(params.uid, clock.localDate, [
    {
      role: 'model',
      content: `**[${windowTitle} · ${channelBadge}]** **${composed.headline}**\n\n${composed.body}`,
      ts: Date.now(),
    },
  ]);

  return { status: 'sent', composed };
}

/**
 * Executes a 1-tap Email/Discord quick action idempotently and returns updated runway status.
 */
export async function executeOutreachQuickAction(params: {
  uid: string;
  action: OutreachActionType;
  date?: string;
  window?: OutreachWindow;
  foodId?: string;
}): Promise<{
  title: string;
  detail: string;
  updatedHeadline?: string;
  updatedBody?: string;
  loggedFoodId?: string;
}> {
  const db = getAdminFirestore();
  const prefs = await adminHealthService.getUserPreferences(db, params.uid);
  const outreach = prefs?.outreach;
  const clock = resolveLocalClock(new Date(), outreach?.timezone);
  const targetDate = params.date || clock.localDate;

  // 1. Control actions (cancel, pause, cadence)
  if (params.action === 'unsubscribe') {
    await db.doc(`users/${params.uid}/preferences/settings`).set(
      {
        outreach: {
          ...(outreach ?? { timezone: clock.timezone, morningHour: 7, middayHour: 12, nightHour: 19, channel: 'email', cadence: '3x' }),
          enabled: false,
        },
      },
      { merge: true },
    );
    await adminHealthService.updateHealthData(db, params.uid, { outreachEnabled: false });
    return {
      title: 'Briefings Canceled',
      detail: 'You will not receive any further Morning, Midday, or Evening messages. ($0, zero hassle.)',
    };
  }

  if (params.action === 'pause_7d') {
    const resumeDate = addIsoDays(clock.localDate, 7);
    await db.doc(`users/${params.uid}/preferences/settings`).set(
      {
        outreach: {
          ...(outreach ?? {}),
          enabled: true,
          pausedUntilDate: resumeDate,
          lastInteractionDate: clock.localDate,
        },
      },
      { merge: true },
    );
    return {
      title: 'Paused for 7 Days',
      detail: `Briefings are snoozed through ${resumeDate} and will resume automatically after that.`,
    };
  }

  if (params.action === 'morning_only') {
    await db.doc(`users/${params.uid}/preferences/settings`).set(
      {
        outreach: {
          ...(outreach ?? {}),
          enabled: true,
          cadence: 'morning_only',
          pausedUntilDate: FieldValue.delete(),
          lastInteractionDate: clock.localDate,
        },
      },
      { merge: true },
    );
    await adminHealthService.updateHealthData(db, params.uid, { outreachEnabled: true });
    return {
      title: 'Switched to Morning-Only (1x/Day)',
      detail: 'You will now receive just one daily morning Eat-By briefing.',
    };
  }

  if (params.action === 'resume_3x') {
    await db.doc(`users/${params.uid}/preferences/settings`).set(
      {
        outreach: {
          ...(outreach ?? {}),
          enabled: true,
          cadence: '3x',
          pausedUntilDate: FieldValue.delete(),
          autoDownshiftedAt: FieldValue.delete(),
          autoPausedAt: FieldValue.delete(),
          lastInteractionDate: clock.localDate,
        },
      },
      { merge: true },
    );
    await adminHealthService.updateHealthData(db, params.uid, { outreachEnabled: true });
    const { composed } = await buildLiveUserOutreach({ uid: params.uid });
    return {
      title: '3x/Day Briefings Active',
      detail: 'Morning, Midday, and Evening briefings are active.',
      updatedHeadline: composed.headline,
      updatedBody: composed.body,
    };
  }

  if (params.action === 'undo_food' && params.foodId) {
    await db.doc(`users/${params.uid}/food_log/${params.foodId}`).set({ ignored: true }, { merge: true });
    await refreshDailyFoodCounters(params.uid, targetDate);
    const { composed } = await buildLiveUserOutreach({ uid: params.uid });
    const nowTs = Date.now();
    await appendOutreachTranscript(params.uid, targetDate, [
      { role: 'user', content: 'Undo last logged meal (via Outreach)', ts: nowTs },
      {
        role: 'model',
        content: `Removed entry from your ledger.\n\n**${composed.headline}** — ${composed.body}`,
        ts: nowTs + 1,
      },
    ]);
    return {
      title: 'Removed Logged Entry',
      detail: 'Your daily ledger and Eat-By runway have been recalculated.',
      updatedHeadline: composed.headline,
      updatedBody: composed.body,
    };
  }

  // Record user engagement so auto-sunset stays fresh
  await db.doc(`users/${params.uid}/preferences/settings`).set(
    {
      outreach: {
        ...(outreach ?? {}),
        lastInteractionDate: clock.localDate,
        autoDownshiftedAt: FieldValue.delete(),
      },
    },
    { merge: true },
  );

  // 2. Non-caloric status check-ins
  if (params.action === 'still_fasting' || params.action === 'kitchen_closed') {
    const { composed } = await buildLiveUserOutreach({ uid: params.uid });
    const label =
      params.action === 'kitchen_closed'
        ? 'Kitchen Closed Locked In'
        : 'Fasting Status Confirmed';
    const nowTs = Date.now();
    await appendOutreachTranscript(params.uid, targetDate, [
      {
        role: 'user',
        content:
          params.action === 'kitchen_closed'
            ? 'Kitchen closed for tonight (1-tap Outreach)'
            : 'Still fasting (1-tap Outreach)',
        ts: nowTs,
      },
      {
        role: 'model',
        content: `**${label}.** **${composed.headline}** — ${composed.body}`,
        ts: nowTs + 1,
      },
    ]);
    return {
      title: label,
      detail: 'Zero calories logged — your live fat-oxidation clock is up to date.',
      updatedHeadline: composed.headline,
      updatedBody: composed.body,
    };
  }

  // 3. Idempotent 1-tap meal presets (protects against email link prefetches / refreshes)
  const actionKey = `${targetDate}_${params.window ?? 'tap'}_${params.action}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const receiptRef = db.doc(`users/${params.uid}/outreach_actions/${actionKey}`);
  const existingReceipt = await receiptRef.get();

  let loggedFoodId: string | undefined;
  let loggedSummary = '';
  let newlyLoggedMealName: string | undefined;

  if (existingReceipt.exists) {
    const data = existingReceipt.data() as { foodId?: string; summary?: string } | undefined;
    loggedFoodId = data?.foodId;
    loggedSummary = data?.summary || 'Already recorded on your ledger today.';
  } else if (params.action === 'same_breakfast') {
    const yesterdayIso = addIsoDays(targetDate, -1);
    const yesterdayFoods = await adminHealthService.queryFoodLog(db, params.uid, yesterdayIso, 30);
    const prevBreakfast = yesterdayFoods.find((f) => f.meal === 'breakfast' && (f.calories || 0) > 0);
    const fallback = PRESET_MEALS.eggs_breakfast;
    const item = prevBreakfast ?? { ...fallback, meal: 'breakfast' as const };

    loggedFoodId = await adminHealthService.logFood(db, params.uid, {
      name: item.name,
      portionG: item.portionG,
      calories: item.calories,
      proteinG: item.proteinG,
      carbsG: item.carbsG,
      fatG: item.fatG,
      fiberG: item.fiberG ?? 0,
      plantMassG: item.plantMassG,
      source: 'user_estimate',
      meal: 'breakfast',
      consumedAt: clock.localTime,
      date: targetDate,
    });
    newlyLoggedMealName = item.name;
    loggedSummary = `Logged ${item.name} (${item.calories} kcal · ${item.proteinG}g protein).`;
    await receiptRef.set({
      foodId: loggedFoodId,
      summary: loggedSummary,
      createdAt: FieldValue.serverTimestamp(),
    });
    await refreshDailyFoodCounters(params.uid, targetDate);
  } else if (params.action in PRESET_MEALS) {
    const preset = PRESET_MEALS[params.action as keyof typeof PRESET_MEALS];
    loggedFoodId = await adminHealthService.logFood(db, params.uid, {
      name: preset.name,
      portionG: preset.portionG,
      calories: preset.calories,
      proteinG: preset.proteinG,
      carbsG: preset.carbsG,
      fatG: preset.fatG,
      fiberG: preset.fiberG,
      plantMassG: preset.plantMassG,
      source: 'user_estimate',
      meal: inferMealFromTime(clock.localTime),
      consumedAt: clock.localTime,
      date: targetDate,
    });
    newlyLoggedMealName = preset.name;
    loggedSummary = `Logged ${preset.name} (${preset.calories} kcal · ${preset.proteinG}g protein).`;
    await receiptRef.set({
      foodId: loggedFoodId,
      summary: loggedSummary,
      createdAt: FieldValue.serverTimestamp(),
    });
    await refreshDailyFoodCounters(params.uid, targetDate);
  }

  const { composed } = await buildLiveUserOutreach({ uid: params.uid });

  if (newlyLoggedMealName) {
    const nowTs = Date.now();
    await appendOutreachTranscript(params.uid, targetDate, [
      {
        role: 'user',
        content: `Logged ${newlyLoggedMealName} (1-tap Outreach)`,
        ts: nowTs,
      },
      {
        role: 'model',
        content: `${loggedSummary}\n\n**${composed.headline}** — ${composed.body}`,
        ts: nowTs + 1,
      },
    ]);
  }

  return {
    title: 'Ledger Updated',
    detail: loggedSummary,
    updatedHeadline: composed.headline,
    updatedBody: composed.body,
    loggedFoodId,
  };
}

/**
 * Processes a free-text reply from Inbound Email or a Discord Modal using `CFO_LITE_MODEL`
 * with a strict daily fair-use cap for free outreach accounts.
 */
export async function processOutreachFreeTextMeal(params: {
  uid: string;
  rawText: string;
  now?: Date;
}): Promise<{
  status: 'logged' | 'stopped' | 'cap_reached' | 'unrecognized';
  headline: string;
  detail: string;
  loggedFoodId?: string;
}> {
  const db = getAdminFirestore();
  const [health, prefs] = await Promise.all([
    adminHealthService.getHealthSummary(db, params.uid),
    adminHealthService.getUserPreferences(db, params.uid),
  ]);

  const outreach = prefs?.outreach;
  const clock = resolveLocalClock(params.now ?? new Date(), outreach?.timezone);

  const isExempt =
    health?.entitlementTier === 'founder' ||
    health?.entitlementTier === 'vip' ||
    health?.entitlementTier === 'pro' ||
    (outreach?.email ? FOUNDER_EMAILS.has(outreach.email.toLowerCase()) : false);

  const usedToday =
    outreach?.dailyParseDate === clock.localDate ? (outreach?.dailyParseCount ?? 0) : 0;

  if (!isExempt && usedToday >= MAX_FREE_OUTREACH_PARSES_PER_DAY) {
    return {
      status: 'cap_reached',
      headline: 'Daily Free-Text Quick-Log Limit Reached (6/day)',
      detail:
        'You can still use all 1-tap preset buttons in your briefings for free, or open cfofitness.app to log directly.',
    };
  }

  const parsed = await parseOutreachMealText({
    uid: params.uid,
    rawText: params.rawText,
    localTime: clock.localTime,
  });

  if (parsed.isStopCommand) {
    await executeOutreachQuickAction({ uid: params.uid, action: 'unsubscribe' });
    return {
      status: 'stopped',
      headline: 'Briefings Canceled',
      detail: 'You are unsubscribed and will receive no further automated briefings.',
    };
  }

  if (!parsed.isFoodLog || !parsed.name) {
    return {
      status: 'unrecognized',
      headline: 'No Meal Detected',
      detail: 'Reply with what you ate (e.g. "3 eggs and sourdough toast" or "40g whey shake"), or reply STOP to cancel briefings.',
    };
  }

  const foodId = await adminHealthService.logFood(db, params.uid, {
    name: parsed.name,
    portionG: Math.max(1, Math.round(parsed.portionG || 250)),
    calories: Math.max(0, Math.round(parsed.calories || 0)),
    proteinG: Math.max(0, Math.round(parsed.proteinG || 0)),
    carbsG: Math.max(0, Math.round(parsed.carbsG || 0)),
    fatG: Math.max(0, Math.round(parsed.fatG || 0)),
    fiberG: Math.max(0, Math.round(parsed.fiberG || 0)),
    plantMassG: parsed.plantMassG ? Math.round(parsed.plantMassG) : undefined,
    alcoholDrinks: parsed.alcoholDrinks ?? 0,
    hasSeedOils: parsed.hasSeedOils ?? false,
    source: parsed.source,
    meal: parsed.meal ?? inferMealFromTime(parsed.consumedAt || clock.localTime),
    consumedAt: parsed.consumedAt || clock.localTime,
    date: clock.localDate,
  });

  await db.doc(`users/${params.uid}/preferences/settings`).set(
    {
      outreach: {
        ...(outreach ?? {}),
        lastInteractionDate: clock.localDate,
        dailyParseDate: clock.localDate,
        dailyParseCount: usedToday + 1,
      },
    },
    { merge: true },
  );

  await refreshDailyFoodCounters(params.uid, clock.localDate);
  const { composed } = await buildLiveUserOutreach({ uid: params.uid });

  const nowTs = Date.now();
  await appendOutreachTranscript(params.uid, clock.localDate, [
    {
      role: 'user',
      content: params.rawText.trim(),
      ts: nowTs,
    },
    {
      role: 'model',
      content: `**Logged ${parsed.name}** (${Math.round(parsed.calories)} kcal · ${Math.round(parsed.proteinG)}g protein).\n\n**${composed.headline}** — ${composed.body}`,
      ts: nowTs + 1,
    },
  ]);

  return {
    status: 'logged',
    headline: `Logged ${parsed.name} (${Math.round(parsed.calories)} kcal · ${Math.round(parsed.proteinG)}g P)`,
    detail: `${composed.headline} — ${composed.body}`,
    loggedFoodId: foodId,
  };
}

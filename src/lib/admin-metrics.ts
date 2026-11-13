import { getAdminAuth, getAdminFirestore } from '@/firebase/admin';
import { adminHealthService } from './health-service-admin';
import { resolveLocalClock } from './outreach-auth';

export interface UserRosterRow {
  uid: string;
  name: string;
  email: string;
  tier: string;
  outreachStatus: string;
  outreachActive: boolean;
  lastOutreachInteraction: string | null;
  lastActiveDate: string | null;
  foodLogsPeriod: number;
  exerciseLogsPeriod: number;
  latestMealLabel: string | null;
  dailyProteinG: number;
  proteinGoalG: number;
  visceralFatPoints: number;
  aiCallsPeriod: number;
  aiCostUsdPeriod: number;
  isNewInPeriod: boolean;
}

export interface UserSummaryMetrics {
  periodDays: number;
  dateRange: {
    start: string;
    end: string;
  };
  totalUsers: number;
  registeredUsers: number;
  anonymousUsers: number;
  dau: number;
  activeUsersPeriod: number;
  wau: number;
  newUsersPeriod: number;
  newUsersWeek: number;
  outreachActiveUsers: number;
  outreach3xUsers: number;
  outreachMorningOnlyUsers: number;
  totalFoodLogsPeriod: number;
  totalExerciseLogsPeriod: number;
  totalFoodLogsWeek: number;
  totalExerciseLogsWeek: number;
  totalLLMCallsPeriod: number;
  totalLLMCallsWeek: number;
  totalAiCostUsdPeriod: number;
  roster: UserRosterRow[];
}

export type WeeklyMetrics = UserSummaryMetrics;

function isoDaysAgo(baseDate: Date, daysAgo: number): string {
  const d = new Date(baseDate.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return resolveLocalClock(d, 'America/Los_Angeles').localDate;
}

function safeAiUidKey(uid: string): string {
  return uid.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Aggregates usage metrics + per-user roster over `periodDays` (default 3 days).
 */
export async function getUserSummaryMetrics(periodDays = 3): Promise<UserSummaryMetrics> {
  const days = Math.max(1, Math.min(30, Math.round(periodDays)));
  const db = getAdminFirestore();
  const now = new Date();

  const endIso = resolveLocalClock(now, 'America/Los_Angeles').localDate;
  const startIso = isoDaysAgo(now, days - 1);
  const yesterdayIso = isoDaysAgo(now, 1);
  const weekStartIso = isoDaysAgo(now, 6);
  const periodCutoffMs = now.getTime() - days * 24 * 60 * 60 * 1000;
  const weekCutoffMs = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const dayCutoffMs = now.getTime() - 24 * 60 * 60 * 1000;

  // Build UTC day keys for AI usage lookup across the period (+1 day buffer for UTC/PT overlap)
  const utcDayKeys: string[] = [];
  for (let i = 0; i <= days; i++) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    utcDayKeys.push(d.toISOString().slice(0, 10));
  }

  // 1. Fetch Firebase Auth users map (single fast batch)
  const authMap = new Map<
    string,
    {
      email?: string;
      displayName?: string;
      isAnonymous: boolean;
      createdAtMs?: number;
      lastSignInMs?: number;
    }
  >();

  try {
    let pageToken: string | undefined;
    do {
      const listRes = await getAdminAuth().listUsers(1000, pageToken);
      for (const u of listRes.users) {
        const isAnon = u.providerData.length === 0 && !u.email;
        authMap.set(u.uid, {
          email: u.email ?? undefined,
          displayName: u.displayName ?? undefined,
          isAnonymous: isAnon,
          createdAtMs: u.metadata.creationTime ? Date.parse(u.metadata.creationTime) : undefined,
          lastSignInMs: u.metadata.lastSignInTime ? Date.parse(u.metadata.lastSignInTime) : undefined,
        });
      }
      pageToken = listRes.pageToken;
    } while (pageToken);
  } catch (err) {
    console.warn('[AdminMetrics] Non-fatal Auth listUsers warning:', err);
  }

  // 2. Fetch Firestore users collection
  const usersSnapshot = await db.collection('users').get();
  const totalUsers = usersSnapshot.size;

  let registeredUsers = 0;
  let anonymousUsers = 0;
  let dau = 0;
  let activeUsersPeriod = 0;
  let wau = 0;
  let newUsersPeriod = 0;
  let newUsersWeek = 0;
  let outreachActiveUsers = 0;
  let outreach3xUsers = 0;
  let outreachMorningOnlyUsers = 0;

  const candidateDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];

  for (const doc of usersSnapshot.docs) {
    const data = doc.data();
    const authInfo = authMap.get(doc.id);
    const email = (authInfo?.email || data.email || data.outreachEmail || '').trim();
    const displayName = (authInfo?.displayName || data.displayName || '').trim();
    const hasOutreach = Boolean(data.outreachEnabled || data.outreachEmail || data.outreachDiscordUserId);
    const isAnon =
      !email &&
      !hasOutreach &&
      (data.isAnonymous === true || authInfo?.isAnonymous === true || !displayName);

    if (isAnon) {
      anonymousUsers++;
    } else {
      registeredUsers++;
    }

    const updatedMs =
      data.updatedAt?.toDate?.()?.getTime?.() ??
      authInfo?.lastSignInMs ??
      undefined;
    const createdMs =
      data.createdAt?.toDate?.()?.getTime?.() ??
      authInfo?.createdAtMs ??
      undefined;
    const lastActiveDate: string | null = data.lastActiveDate || null;

    const active24h =
      (updatedMs != null && updatedMs >= dayCutoffMs) ||
      (lastActiveDate != null && lastActiveDate >= yesterdayIso);
    const activeInPeriod =
      (updatedMs != null && updatedMs >= periodCutoffMs) ||
      (lastActiveDate != null && lastActiveDate >= startIso);
    const activeInWeek =
      (updatedMs != null && updatedMs >= weekCutoffMs) ||
      (lastActiveDate != null && lastActiveDate >= weekStartIso);

    if (active24h) dau++;
    if (activeInPeriod) activeUsersPeriod++;
    if (activeInWeek) wau++;

    if (createdMs != null && createdMs >= periodCutoffMs) newUsersPeriod++;
    if (createdMs != null && createdMs >= weekCutoffMs) newUsersWeek++;

    // Include in detailed per-user query if non-anonymous, outreach-enrolled, or active in last 7d
    if (!isAnon || hasOutreach || activeInWeek) {
      candidateDocs.push(doc);
    }
  }

  let totalFoodLogsPeriod = 0;
  let totalExerciseLogsPeriod = 0;
  let totalLLMCallsPeriod = 0;
  let totalAiCostUsdPeriod = 0;
  const roster: UserRosterRow[] = [];

  const BATCH_SIZE = 12;
  for (let i = 0; i < candidateDocs.length; i += BATCH_SIZE) {
    const batch = candidateDocs.slice(i, i + BATCH_SIZE);
    const batchRows = await Promise.all(
      batch.map(async (userDoc) => {
        const uid = userDoc.id;
        const data = userDoc.data();
        const authInfo = authMap.get(uid);

        const [prefs, foodSnap, exSnap, ...aiDaySnaps] = await Promise.all([
          adminHealthService.getUserPreferences(db, uid),
          db.collection(`users/${uid}/food_log`).where('date', '>=', startIso).get(),
          db.collection(`users/${uid}/exercise_log`).where('date', '>=', startIso).get(),
          ...utcDayKeys.map((dayKey) =>
            db.doc(`ai_usage/${safeAiUidKey(uid)}/days/${dayKey}`).get(),
          ),
        ]);

        const outreach = prefs?.outreach;
        const isOutreachEnabled = Boolean(outreach?.enabled || data.outreachEnabled);
        let outreachStatus = 'Off';
        if (isOutreachEnabled) {
          const ch = outreach?.channel === 'discord' ? 'Discord' : outreach?.channel === 'both' ? 'Email+Discord' : 'Email';
          const cad = outreach?.cadence === 'morning_only' ? '1x AM' : '3x/day';
          outreachStatus = `${cad} ${ch}`;
        } else if (outreach?.autoPausedAt) {
          outreachStatus = 'Auto-Paused';
        } else if (outreach?.email || data.outreachEmail) {
          outreachStatus = 'Paused';
        }

        if (isOutreachEnabled) {
          outreachActiveUsers++;
          if (outreach?.cadence === 'morning_only') outreachMorningOnlyUsers++;
          else outreach3xUsers++;
        }

        // Latest meal in period
        let latestMealLabel: string | null = null;
        let latestMealKey = '';
        foodSnap.docs.forEach((fDoc) => {
          const f = fDoc.data();
          const sortKey = `${f.date || ''}T${f.consumedAt || '00:00'}`;
          if (sortKey >= latestMealKey && f.name) {
            latestMealKey = sortKey;
            latestMealLabel = `${f.name} (${Math.round(f.calories || 0)} kcal, ${Math.round(f.proteinG || 0)}g P)`;
          }
        });

        let userAiCalls = 0;
        let userAiCost = 0;
        for (const aiSnap of aiDaySnaps) {
          if (aiSnap.exists) {
            const ad = aiSnap.data() || {};
            userAiCalls += Number(ad.calls || 0);
            userAiCost += Number(ad.costUsd || 0);
          }
        }

        totalFoodLogsPeriod += foodSnap.size;
        totalExerciseLogsPeriod += exSnap.size;
        totalLLMCallsPeriod += userAiCalls;
        totalAiCostUsdPeriod += userAiCost;

        const email = (
          authInfo?.email ||
          outreach?.email ||
          data.outreachEmail ||
          data.email ||
          ''
        ).trim();
        const rawName = (authInfo?.displayName || data.displayName || '').trim();
        const fallbackName = email ? email.split('@')[0] : uid.startsWith('outreach_') ? 'Outreach Subscriber' : `Guest (${uid.slice(0, 6)})`;

        const createdMs =
          data.createdAt?.toDate?.()?.getTime?.() ??
          authInfo?.createdAtMs ??
          undefined;

        const isAnonRow =
          !email &&
          !isOutreachEnabled &&
          (data.isAnonymous === true || authInfo?.isAnonymous === true || !rawName);

        // Skip completely idle anonymous rows that had 0 logs and 0 AI calls in period
        if (isAnonRow && foodSnap.size === 0 && exSnap.size === 0 && userAiCalls === 0) {
          return null;
        }

        const row: UserRosterRow = {
          uid,
          name: rawName || fallbackName,
          email: email || '—',
          tier: String(data.entitlementTier || data.subscriptionStatus || 'free'),
          outreachStatus,
          outreachActive: isOutreachEnabled,
          lastOutreachInteraction: outreach?.lastInteractionDate || null,
          lastActiveDate: data.lastActiveDate || (latestMealKey ? latestMealKey.split('T')[0] : null),
          foodLogsPeriod: foodSnap.size,
          exerciseLogsPeriod: exSnap.size,
          latestMealLabel,
          dailyProteinG: Math.round(Number(data.dailyProteinG || 0)),
          proteinGoalG: Math.round(Number(prefs?.targets?.proteinGoal || 150)),
          visceralFatPoints: Math.round(Number(data.visceralFatPoints || 0)),
          aiCallsPeriod: userAiCalls,
          aiCostUsdPeriod: userAiCost,
          isNewInPeriod: Boolean(createdMs != null && createdMs >= periodCutoffMs),
        };
        return row;
      }),
    );

    for (const r of batchRows) {
      if (r) roster.push(r);
    }
  }

  // Also add any system-level AI cost (e.g. system:admin_report)
  for (const sysId of ['system_admin_report', 'public_shared_meal']) {
    const snaps = await Promise.all(
      utcDayKeys.map((dayKey) => db.doc(`ai_usage/${sysId}/days/${dayKey}`).get()),
    );
    for (const s of snaps) {
      if (s.exists) {
        const d = s.data() || {};
        totalLLMCallsPeriod += Number(d.calls || 0);
        totalAiCostUsdPeriod += Number(d.costUsd || 0);
      }
    }
  }

  // Sort roster: Outreach-active or Period-active with meals first, then by lastActiveDate desc
  roster.sort((a, b) => {
    const aScore = (a.foodLogsPeriod > 0 ? 4 : 0) + (a.outreachActive ? 2 : 0) + (a.aiCallsPeriod > 0 ? 1 : 0);
    const bScore = (b.foodLogsPeriod > 0 ? 4 : 0) + (b.outreachActive ? 2 : 0) + (b.aiCallsPeriod > 0 ? 1 : 0);
    if (bScore !== aScore) return bScore - aScore;
    return (b.lastActiveDate || '').localeCompare(a.lastActiveDate || '');
  });

  return {
    periodDays: days,
    dateRange: {
      start: startIso,
      end: endIso,
    },
    totalUsers,
    registeredUsers,
    anonymousUsers,
    dau,
    activeUsersPeriod,
    wau,
    newUsersPeriod,
    newUsersWeek,
    outreachActiveUsers,
    outreach3xUsers,
    outreachMorningOnlyUsers,
    totalFoodLogsPeriod,
    totalExerciseLogsPeriod,
    totalFoodLogsWeek: totalFoodLogsPeriod,
    totalExerciseLogsWeek: totalExerciseLogsPeriod,
    totalLLMCallsPeriod,
    totalLLMCallsWeek: totalLLMCallsPeriod,
    totalAiCostUsdPeriod,
    roster,
  };
}

export async function getWeeklyMetrics(): Promise<WeeklyMetrics> {
  return getUserSummaryMetrics(7);
}

export function renderUserSummaryEmailHtml(params: {
  metrics: UserSummaryMetrics;
  summary: string;
}): string {
  const { metrics, summary } = params;
  const costFormatted = `$${metrics.totalAiCostUsdPeriod.toFixed(4)}`;

  const rosterRowsHtml = metrics.roster
    .slice(0, 40)
    .map((u) => {
      const badgeBg = u.outreachActive ? '#dcfce7' : '#f1f5f9';
      const badgeColor = u.outreachActive ? '#166534' : '#475569';
      const newBadge = u.isNewInPeriod
        ? `<span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:999px;background:#dbeafe;color:#1d4ed8;font-size:10px;font-weight:800;">NEW</span>`
        : '';
      const latestMealHtml = u.latestMealLabel
        ? `<div style="font-size:11px;color:#475569;margin-top:3px;">Last: ${escapeHtml(u.latestMealLabel)}</div>`
        : '';

      return `
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:10px 8px;vertical-align:top;">
            <div style="font-weight:700;font-size:13px;color:#0f172a;">${escapeHtml(u.name)}${newBadge}</div>
            <div style="font-size:11px;color:#64748b;">${escapeHtml(u.email)}</div>
          </td>
          <td style="padding:10px 8px;vertical-align:top;">
            <span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${badgeBg};color:${badgeColor};font-size:11px;font-weight:700;">
              ${escapeHtml(u.outreachStatus)}
            </span>
            ${
              u.lastOutreachInteraction
                ? `<div style="font-size:10px;color:#64748b;margin-top:3px;">Touch: ${escapeHtml(u.lastOutreachInteraction)}</div>`
                : ''
            }
          </td>
          <td style="padding:10px 8px;vertical-align:top;font-size:12px;color:#0f172a;">
            <strong>${u.foodLogsPeriod}</strong> meals · <strong>${u.exerciseLogsPeriod}</strong> ex
            ${latestMealHtml}
          </td>
          <td style="padding:10px 8px;vertical-align:top;font-size:12px;color:#0f172a;">
            <div>${escapeHtml(u.lastActiveDate || '—')}</div>
            <div style="font-size:11px;color:#64748b;">${u.dailyProteinG}/${u.proteinGoalG}g P · VF ${u.visceralFatPoints}</div>
          </td>
          <td style="padding:10px 8px;vertical-align:top;text-align:right;font-size:12px;color:#0f172a;white-space:nowrap;">
            <div><strong>${u.aiCallsPeriod}</strong> calls</div>
            <div style="font-size:11px;color:#64748b;">$${u.aiCostUsdPeriod.toFixed(4)}</div>
          </td>
        </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:20px 12px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
    <div style="background:#0f172a;color:#ffffff;padding:18px 22px;">
      <div style="font-size:11px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#34d399;">
        the CFO · ${metrics.periodDays}-Day Founder User Summary
      </div>
      <div style="font-size:20px;font-weight:900;margin-top:4px;">
        ${metrics.activeUsersPeriod} Active Users · ${metrics.outreachActiveUsers} on Daily Briefings
      </div>
      <div style="font-size:12px;color:#94a3b8;margin-top:4px;">
        Window: ${escapeHtml(metrics.dateRange.start)} → ${escapeHtml(metrics.dateRange.end)} (PT)
      </div>
    </div>

    <div style="padding:20px 22px;">
      <div style="background:#f8fafc;border-left:4px solid #10b981;padding:12px 14px;border-radius:6px;font-size:13px;line-height:1.55;color:#1e293b;margin-bottom:18px;">
        ${escapeHtml(summary)}
      </div>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;">
        <tr>
          <td style="padding:10px;border:1px solid #e2e8f0;width:25%;">
            <div style="font-size:10px;font-weight:800;text-transform:uppercase;color:#64748b;">Registered Users</div>
            <div style="font-size:18px;font-weight:900;color:#0f172a;margin-top:2px;">${metrics.registeredUsers}</div>
            <div style="font-size:11px;color:#64748b;">+${metrics.newUsersPeriod} new · ${metrics.anonymousUsers} anon</div>
          </td>
          <td style="padding:10px;border:1px solid #e2e8f0;width:25%;">
            <div style="font-size:10px;font-weight:800;text-transform:uppercase;color:#64748b;">Active (${metrics.periodDays}d / 24h)</div>
            <div style="font-size:18px;font-weight:900;color:#0f172a;margin-top:2px;">${metrics.activeUsersPeriod} / ${metrics.dau}</div>
            <div style="font-size:11px;color:#64748b;">7d WAU: ${metrics.wau}</div>
          </td>
          <td style="padding:10px;border:1px solid #e2e8f0;width:25%;">
            <div style="font-size:10px;font-weight:800;text-transform:uppercase;color:#64748b;">Briefings Active</div>
            <div style="font-size:18px;font-weight:900;color:#059669;margin-top:2px;">${metrics.outreachActiveUsers}</div>
            <div style="font-size:11px;color:#64748b;">${metrics.outreach3xUsers} on 3x · ${metrics.outreachMorningOnlyUsers} on 1x</div>
          </td>
          <td style="padding:10px;border:1px solid #e2e8f0;width:25%;">
            <div style="font-size:10px;font-weight:800;text-transform:uppercase;color:#64748b;">${metrics.periodDays}d Logs &amp; AI Cost</div>
            <div style="font-size:18px;font-weight:900;color:#0f172a;margin-top:2px;">${metrics.totalFoodLogsPeriod} meals</div>
            <div style="font-size:11px;color:#64748b;">${metrics.totalLLMCallsPeriod} AI (${costFormatted})</div>
          </td>
        </tr>
      </table>

      <div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:#475569;margin-bottom:8px;">
        User Roster (${metrics.roster.length})
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-top:2px solid #0f172a;">
        <thead>
          <tr style="background:#f8fafc;border-bottom:1px solid #cbd5e1;text-align:left;font-size:11px;color:#475569;text-transform:uppercase;">
            <th style="padding:8px;">User</th>
            <th style="padding:8px;">Briefings</th>
            <th style="padding:8px;">${metrics.periodDays}d Activity</th>
            <th style="padding:8px;">Latest Snapshot</th>
            <th style="padding:8px;text-align:right;">${metrics.periodDays}d AI</th>
          </tr>
        </thead>
        <tbody>
          ${
            rosterRowsHtml ||
            `<tr><td colspan="5" style="padding:14px;text-align:center;color:#64748b;font-size:13px;">No registered or active users in this window.</td></tr>`
          }
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
}

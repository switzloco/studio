import { FieldValue } from 'firebase-admin/firestore';
import { ai, CFO_LITE_MODEL, CFO_MODEL } from '@/ai/genkit';
import { z } from 'genkit';
import { getAdminFirestore } from '@/firebase/admin';
import {
  getUserSummaryMetrics,
  renderUserSummaryEmailHtml,
  type UserSummaryMetrics,
} from '@/lib/admin-metrics';
import { sendAdminReportEmail } from '@/lib/admin-email';
import { trackAiUsage } from '@/lib/ai-usage';

/**
 * @fileOverview Cost-optimized 1-pass executive user summary flow for founder reports.
 */

export async function generateFounderUserSummary(periodDays = 3): Promise<{
  summary: string;
  metrics: UserSummaryMetrics;
}> {
  const metrics = await getUserSummaryMetrics(periodDays);

  const topActiveLines = metrics.roster
    .slice(0, 12)
    .map(
      (u) =>
        `- ${u.name} (${u.email}): Briefings=${u.outreachStatus}, ${metrics.periodDays}d=${u.foodLogsPeriod} meals/${u.exerciseLogsPeriod} ex, last=${u.lastActiveDate || 'none'}, AI=$${u.aiCostUsdPeriod.toFixed(4)}`,
    )
    .join('\n');

  const promptText = `You are the Chief Operating Analyst for "the CFO" fitness app reporting directly to founder Nick Switzer.
Write a crisp, direct 2–3 sentence executive pulse covering the last ${metrics.periodDays} days (${metrics.dateRange.start} to ${metrics.dateRange.end}):
- Registered users: ${metrics.registeredUsers} (+${metrics.newUsersPeriod} new; ${metrics.anonymousUsers} anon sessions)
- Active (${metrics.periodDays}d / 24h): ${metrics.activeUsersPeriod} / ${metrics.dau}
- Daily Briefings active: ${metrics.outreachActiveUsers} (${metrics.outreach3xUsers} on 3x/day, ${metrics.outreachMorningOnlyUsers} on 1x AM)
- Volume: ${metrics.totalFoodLogsPeriod} meals, ${metrics.totalExerciseLogsPeriod} workouts
- Total AI spend: ${metrics.totalLLMCallsPeriod} calls ($${metrics.totalAiCostUsdPeriod.toFixed(4)})
Top roster snapshot:
${topActiveLines || '(none)'}

Plain text only (no markdown headers or bullets). Mention specific active/enrolled users by first name or email handle where notable, call out anyone enrolled on briefings with 0 meals logged if applicable, and note unit cost health.`;

  try {
    let res;
    try {
      res = await ai.generate({
        model: CFO_LITE_MODEL,
        use: [
          trackAiUsage({
            uid: 'system:admin_report',
            feature: 'admin_report',
            model: CFO_LITE_MODEL,
          }),
        ],
        prompt: promptText,
      });
    } catch {
      res = await ai.generate({
        model: CFO_MODEL,
        use: [
          trackAiUsage({
            uid: 'system:admin_report',
            feature: 'admin_report',
            model: CFO_MODEL,
          }),
        ],
        prompt: promptText,
      });
    }

    const clean = (res.text || '').trim();
    if (clean) {
      return { summary: clean, metrics };
    }
  } catch (err) {
    console.warn('[AdminReport] Falling back to deterministic summary:', err);
  }

  const fallback = `${metrics.activeUsersPeriod} of ${metrics.registeredUsers} registered users were active over the last ${metrics.periodDays} days (${metrics.dau} in the last 24h), logging ${metrics.totalFoodLogsPeriod} meals and ${metrics.totalExerciseLogsPeriod} workouts. ${metrics.outreachActiveUsers} users are active on Daily Briefings, and total Vertex AI spend across ${metrics.totalLLMCallsPeriod} calls was $${metrics.totalAiCostUsdPeriod.toFixed(4)}.`;
  return { summary: fallback, metrics };
}

export const adminReportFlow = ai.defineFlow(
  {
    name: 'admin_report_flow',
    inputSchema: z.object({ periodDays: z.number().optional() }).optional(),
    outputSchema: z.object({
      summary: z.string(),
      metrics: z.any(),
    }),
  },
  async (input) => {
    return generateFounderUserSummary(input?.periodDays ?? 7);
  },
);

const FOUNDER_EMAIL = 'nicholas.switzer@gmail.com';
const MIN_HOURS_BETWEEN_SENDS = 68; // ~3 days (72h) minus 4h morning schedule buffer

export async function sendFounderUserSummaryNow(params?: {
  periodDays?: number;
  force?: boolean;
}) {
  const periodDays = Math.max(1, Math.min(30, Math.round(params?.periodDays ?? 3)));
  const force = Boolean(params?.force);
  const db = getAdminFirestore();
  const stateRef = db.doc('admin_state/user_summary_3d');
  const nowMs = Date.now();

  let previousLastSentAtMs = 0;
  if (!force) {
    const gate = await db.runTransaction(async (tx) => {
      const snap = await tx.get(stateRef);
      const data = snap.data();
      const lastSentAtMs = Number(data?.lastSentAtMs || 0);
      previousLastSentAtMs = lastSentAtMs;
      if (lastSentAtMs > 0) {
        const hoursElapsed = (nowMs - lastSentAtMs) / (3600 * 1000);
        if (hoursElapsed < MIN_HOURS_BETWEEN_SENDS) {
          return {
            claimed: false as const,
            hoursSinceLast: Number(hoursElapsed.toFixed(1)),
            nextDueInHours: Number((72 - hoursElapsed).toFixed(1)),
          };
        }
      }
      if (
        data?.status === 'sending' &&
        nowMs - Number(data.claimedAtMs || 0) < 10 * 60 * 1000
      ) {
        return {
          claimed: false as const,
          hoursSinceLast: 0,
          nextDueInHours: 72,
        };
      }
      tx.set(
        stateRef,
        {
          status: 'sending',
          claimedAtMs: nowMs,
          lastSentAtMs: nowMs,
        },
        { merge: true },
      );
      return { claimed: true as const };
    });

    if (!gate.claimed) {
      return {
        ok: true,
        skipped: true,
        hoursSinceLast: gate.hoursSinceLast,
        nextDueInHours: gate.nextDueInHours,
      };
    }
  }

  const { summary, metrics } = await generateFounderUserSummary(periodDays);
  const html = renderUserSummaryEmailHtml({ metrics, summary });
  const subject = `[the CFO] ${metrics.periodDays}d User Summary · ${metrics.activeUsersPeriod} Active · ${metrics.outreachActiveUsers} on Briefings`;

  const emailRes = await sendAdminReportEmail(FOUNDER_EMAIL, subject, html);

  if (emailRes.success) {
    await stateRef.set(
      {
        status: 'sent',
        lastSentAtMs: nowMs,
        lastSentIso: new Date(nowMs).toISOString(),
        periodDays: metrics.periodDays,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  } else if (!force) {
    await stateRef.set(
      {
        status: 'failed',
        lastSentAtMs: previousLastSentAtMs,
      },
      { merge: true },
    );
  }

  return {
    ok: emailRes.success,
    skipped: false,
    emailSent: emailRes.success,
    error: emailRes.error,
    subject,
    summary,
    counts: {
      registeredUsers: metrics.registeredUsers,
      anonymousUsers: metrics.anonymousUsers,
      activeUsersPeriod: metrics.activeUsersPeriod,
      dau: metrics.dau,
      outreachActiveUsers: metrics.outreachActiveUsers,
      totalFoodLogsPeriod: metrics.totalFoodLogsPeriod,
      totalLLMCallsPeriod: metrics.totalLLMCallsPeriod,
      totalAiCostUsdPeriod: Number(metrics.totalAiCostUsdPeriod.toFixed(4)),
      rosterSize: metrics.roster.length,
    },
  };
}

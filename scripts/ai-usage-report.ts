/**
 * Per-user AI cost report.
 *
 * Usage:
 *   gcloud auth application-default login      # one-time, for Firestore access
 *   npx tsx scripts/ai-usage-report.ts          # current month (UTC)
 *   npx tsx scripts/ai-usage-report.ts 2026-11  # specific month
 *
 * Reads ai_usage_monthly/{month} (written by src/lib/ai-usage.ts) and joins
 * each uid to its email + entitlement tier. Costs are ESTIMATES based on the
 * PRICING table in src/lib/ai-usage.ts — reconcile with the GCP billing console.
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'studio-4236902803-1eba2';
initializeApp({ projectId });
const db = getFirestore();
const auth = getAuth();

const month = process.argv[2] ?? new Date().toISOString().slice(0, 7);
if (!/^\d{4}-\d{2}$/.test(month)) {
  console.error('Month must be YYYY-MM');
  process.exit(1);
}

const usd = (n: number) => `$${(n ?? 0).toFixed(n >= 1 ? 2 : 4)}`;
const k = (n: number) => `${((n ?? 0) / 1000).toFixed(0)}k`;

async function main() {
  const snap = await db.doc(`ai_usage_monthly/${month}`).get();
  if (!snap.exists) {
    console.log(`No AI usage recorded for ${month}.`);
    return;
  }
  const g = snap.data()!;

  console.log(`\nAI usage — ${month} (estimated)\n`);
  console.log(`Total: ${usd(g.costUsd)} across ${g.calls} model calls`);
  console.log(
    `Tokens: ${k(g.inputTokens)} in (${k(g.cachedTokens)} cached) · ${k(g.outputTokens)} out · ${k(g.thoughtsTokens)} thinking\n`,
  );

  console.log('By feature:');
  console.table(
    Object.entries<any>(g.features ?? {})
      .sort((a, b) => b[1].costUsd - a[1].costUsd)
      .map(([feature, v]) => ({ feature, calls: v.calls, cost: usd(v.costUsd) })),
  );

  const users = Object.entries<any>(g.users ?? {}).sort((a, b) => b[1].costUsd - a[1].costUsd);
  const rows = await Promise.all(
    users.map(async ([uid, v]) => {
      let email = '';
      let tier = '';
      if (!/^(public|system)_/.test(uid)) {
        const [userRec, userDoc, monthDoc] = await Promise.all([
          auth.getUser(uid).catch(() => null),
          db.doc(`users/${uid}`).get().catch(() => null),
          db.doc(`ai_usage/${uid}/months/${month}`).get().catch(() => null),
        ]);
        email = userRec?.email ?? (userRec ? '(anonymous)' : '');
        tier = (userDoc?.data()?.entitlementTier as string) ?? 'free';
        const m = monthDoc?.data();
        return {
          user: email || uid,
          tier,
          calls: v.calls,
          cost: usd(v.costUsd),
          inTok: k(m?.inputTokens),
          outTok: k((m?.outputTokens ?? 0) + (m?.thoughtsTokens ?? 0)),
          perCall: usd(v.costUsd / Math.max(1, v.calls)),
        };
      }
      return { user: uid, tier: '-', calls: v.calls, cost: usd(v.costUsd), inTok: '', outTok: '', perCall: usd(v.costUsd / Math.max(1, v.calls)) };
    }),
  );

  console.log(`\nBy user (${rows.length}):`);
  console.table(rows);

  const founders = rows.filter((r) => r.tier === 'founder');
  if (founders.length) {
    const total = users
      .filter((_, i) => rows[i].tier === 'founder')
      .reduce((s, [, v]) => s + (v.costUsd ?? 0), 0);
    console.log(`Founder tier: ${founders.length} users · ${usd(total)} total · ${usd(total / founders.length)} avg/user`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

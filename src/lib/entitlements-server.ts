import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore, type VerifiedAuthToken } from '@/firebase/admin';
import {
  ANONYMOUS_FREE_AI_AUDITS_LIMIT,
  DAILY_HIGH_SPEED_TURNS,
  FOUNDER_EMAILS,
  FREE_AI_AUDITS_LIMIT,
  FRIENDS_BONUS_AI_AUDITS,
  PRO_MONTHLY_AI_AUDITS_CAP,
  PRO_MONTHLY_HIGH_SPEED_TURNS,
  type EntitlementStatus,
  type EntitlementTier,
} from './entitlements';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Additional founder/VIP emails or UIDs configurable via environment variables.
 */
function isServerFounderIdentity(auth: VerifiedAuthToken): boolean {
  const email = auth.email?.trim().toLowerCase();
  if (email && FOUNDER_EMAILS.has(email)) return true;

  const extraEmails = (process.env.CFO_VIP_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (email && extraEmails.includes(email)) return true;

  const extraUids = (process.env.CFO_FOUNDER_UIDS || process.env.NEXT_PUBLIC_CFO_FOUNDER_UIDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (auth.uid && extraUids.includes(auth.uid)) return true;

  return false;
}

/**
 * Master Founder codes (private to Nick / App Store review).
 * Only these codes grant VIP status.
 */
export function getValidFounderCodes(): Set<string> {
  const defaults = ['SWITZER', 'NICKVIP'];
  const fromEnv = (process.env.CFO_FOUNDER_CODES || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return new Set([...defaults, ...fromEnv]);
}

/**
 * Shareable Friends & Family Credit Pack codes (case-insensitive).
 * Each grants a ONE-TIME +25 Bonus AI Audits (`FRIENDS_BONUS_AI_AUDITS`) on top of
 * the 10 starter audits (35 total audits, with bonus turns routed to gemini-2.5-flash-lite
 * so total gift cost is capped at ~$0.05/person).
 */
export function getValidCreditPackCodes(): Set<string> {
  const defaults = [
    'FRIENDS',
    'FRIENDS25',
    'FAMILY',
    'FAMILY25',
    'BALLERS',
    'BEERBELLYBALLERS',
    'CFOPARTNER',
    'CFOGIFT',
    'PARTNERGIFT',
    'TAYLORJOULE',
    'BODYSPEC',
    'SUBSTACK',
    'GIFT25',
  ];
  const fromEnv = (process.env.CFO_CREDIT_CODES || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return new Set([...defaults, ...fromEnv]);
}

export { FRIENDS_BONUS_AI_AUDITS };

/**
 * Server-authoritative entitlement + profitability governor check before running Gemini AI flows.
 *
 * - Founder (`nicholas.switzer@gmail.com`) is ALWAYS exempt from all caps.
 * - `pro` and `vip` users get 450 AI turns per rolling 30-day cycle (`PRO_MONTHLY_AI_AUDITS_CAP`).
 *   Turns 1-300 run on full `gemini-2.5-flash`; turns 301-450 auto-downshift to `gemini-2.5-flash-lite`
 *   so worst-case monthly cost is <= $1.08 (guaranteeing >=82% net margin on Annual $79.99/yr).
 * - `free` users get 3 turns while unsigned-in anonymous, 10 turns once signed in, plus +25 bonus
 *   turns with a Friends & Family credit code (with bonus turns >= 10 routed to `gemini-2.5-flash-lite`).
 */
export async function checkServerEntitlement(
  auth: VerifiedAuthToken,
  options?: { isInitGreeting?: boolean },
): Promise<EntitlementStatus> {
  // 1. Fast-path: Founder identity via verified Firebase Auth token
  if (isServerFounderIdentity(auth)) {
    const db = getAdminFirestore();
    void db
      .doc(`users/${auth.uid}`)
      .set({ entitlementTier: 'founder' }, { merge: true })
      .catch(() => {});

    return {
      allowed: true,
      canUseAiCoach: true,
      tier: 'founder',
      badgeLabel: 'Founder Immunity',
      isExempt: true,
      aiAuditsUsed: 0,
      freeLimit: FREE_AI_AUDITS_LIMIT,
      remainingFreeAudits: null,
    };
  }

  // 2. Read user doc for stored entitlementTier, aiAuditsUsed, bonusAiAudits, and monthly cycle usage
  const db = getAdminFirestore();
  const userRef = db.doc(`users/${auth.uid}`);
  const snap = await userRef.get();
  const data = (snap.exists ? snap.data() : {}) as {
    entitlementTier?: EntitlementTier;
    aiAuditsUsed?: number;
    bonusAiAudits?: number;
    monthlyAiAuditsUsed?: number;
    monthlyWindowStartMs?: number;
    redeemedFounderCode?: string;
    redeemedGiftCode?: string;
    email?: string;
  };

  // Also check if stored email on user doc matches founder list
  const storedEmail = data.email?.trim().toLowerCase();
  if (storedEmail && FOUNDER_EMAILS.has(storedEmail)) {
    return {
      allowed: true,
      canUseAiCoach: true,
      tier: 'founder',
      badgeLabel: 'Founder Immunity',
      isExempt: true,
      aiAuditsUsed: data.aiAuditsUsed ?? 0,
      freeLimit: FREE_AI_AUDITS_LIMIT,
      remainingFreeAudits: null,
    };
  }

  const tier: EntitlementTier =
    data.entitlementTier && data.entitlementTier !== 'free'
      ? data.entitlementTier
      : data.redeemedFounderCode
      ? 'vip'
      : 'free';
  const used = Math.max(0, Number(data.aiAuditsUsed ?? 0));

  if (tier === 'founder') {
    return {
      allowed: true,
      canUseAiCoach: true,
      tier: 'founder',
      badgeLabel: 'Founder Immunity',
      isExempt: true,
      aiAuditsUsed: used,
      freeLimit: FREE_AI_AUDITS_LIMIT,
      remainingFreeAudits: null,
    };
  }

  if (tier === 'vip' || tier === 'pro') {
    const now = Date.now();
    const windowStart = Number(data.monthlyWindowStartMs ?? 0);
    const windowExpired = !windowStart || now - windowStart >= THIRTY_DAYS_MS;
    const monthlyUsed = windowExpired ? 0 : Math.max(0, Number(data.monthlyAiAuditsUsed ?? 0));
    const allowed = options?.isInitGreeting
      ? monthlyUsed <= PRO_MONTHLY_AI_AUDITS_CAP
      : monthlyUsed < PRO_MONTHLY_AI_AUDITS_CAP;

    // Auto-downshift heavy Pro usage (>300 turns/month) to flash-lite to lock in >82% margin
    const recommendedModel =
      monthlyUsed >= PRO_MONTHLY_HIGH_SPEED_TURNS ? 'googleai/gemini-2.5-flash-lite' : undefined;

    return {
      allowed,
      canUseAiCoach: allowed,
      tier,
      badgeLabel: tier === 'vip' ? 'Founding Partner' : 'Executive Retainer',
      isExempt: true,
      aiAuditsUsed: used,
      freeLimit: PRO_MONTHLY_AI_AUDITS_CAP,
      monthlyCapReached: !allowed,
      recommendedModel,
      remainingFreeAudits: null,
    };
  }

  const bonus = Math.max(0, Number(data.bonusAiAudits ?? 0));
  const isAnonWithoutGift = Boolean(auth.isAnonymous && !auth.email && !storedEmail && bonus === 0);
  const baseLimit = isAnonWithoutGift ? ANONYMOUS_FREE_AI_AUDITS_LIMIT : FREE_AI_AUDITS_LIMIT;
  const effectiveLimit = baseLimit + bonus;

  const remaining = Math.max(0, effectiveLimit - used);
  const allowed = options?.isInitGreeting ? used <= effectiveLimit : used < effectiveLimit;

  // Once a user is into their bonus gift credits (used >= 10), route to flash-lite (4x cheaper)
  const recommendedModel =
    used >= FREE_AI_AUDITS_LIMIT ? 'googleai/gemini-2.5-flash-lite' : undefined;

  return {
    allowed,
    canUseAiCoach: allowed,
    tier: 'free',
    badgeLabel: bonus > 0 ? `Partner Credit Pack (${remaining} left)` : 'Open Terminal',
    isExempt: false,
    aiAuditsUsed: used,
    freeLimit: effectiveLimit,
    bonusAudits: bonus,
    redeemedGiftCode: data.redeemedGiftCode,
    requiresSignIn: !allowed && isAnonWithoutGift,
    recommendedModel,
    remainingFreeAudits: remaining,
  };
}

export { DAILY_HIGH_SPEED_TURNS };

/**
 * Increments `aiAuditsUsed` and rolling 30-day `monthlyAiAuditsUsed` on the user's
 * Firestore doc after a successful AI turn. Never increments for Founder, and
 * does not count the automatic `__init__` session greeting.
 */
export async function recordAiAuditTurn(
  auth: VerifiedAuthToken,
  isInitGreeting = false,
): Promise<void> {
  if (isInitGreeting) return;
  if (isServerFounderIdentity(auth)) return;

  try {
    const db = getAdminFirestore();
    const userRef = db.doc(`users/${auth.uid}`);
    const now = Date.now();
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const data = snap.exists ? snap.data() : undefined;
      const windowStart = Number(data?.monthlyWindowStartMs ?? 0);
      const windowExpired = !windowStart || now - windowStart >= THIRTY_DAYS_MS;

      tx.set(
        userRef,
        {
          aiAuditsUsed: FieldValue.increment(1),
          monthlyAiAuditsUsed: windowExpired ? 1 : FieldValue.increment(1),
          monthlyWindowStartMs: windowExpired ? now : windowStart,
          lastAiAuditAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });
  } catch (err) {
    console.warn('[Entitlements] Failed to increment aiAuditsUsed:', err);
  }
}

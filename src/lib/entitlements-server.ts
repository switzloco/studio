import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore, type VerifiedAuthToken } from '@/firebase/admin';
import {
  ANONYMOUS_FREE_AI_AUDITS_LIMIT,
  FOUNDER_EMAILS,
  FREE_AI_AUDITS_LIMIT,
  FRIENDS_BONUS_AI_AUDITS,
  type EntitlementStatus,
  type EntitlementTier,
} from './entitlements';

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
 * Only these codes grant unlimited VIP immunity.
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
 * the 15 starter audits (40 total audits, max ~$0.11 LLM cost), so Nick can tell
 * friends & family to share them freely without risking an uncapped Gemini bill.
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
 * Server-authoritative entitlement check before running paid Gemini AI flows.
 *
 * - Founder (`nicholas.switzer@gmail.com`) is ALWAYS exempt and automatically
 *   stamped with `entitlementTier: 'founder'` in Firestore if not already set.
 * - `vip` and `pro` users are ALWAYS exempt.
 * - `free` users receive `FREE_AI_AUDITS_LIMIT` (15) complimentary AI turns
 *   (or 5 turns while unsigned-in anonymous, plus +25 if they redeemed a Friends & Family credit code).
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

  // 2. Read user doc for stored entitlementTier, aiAuditsUsed, and bonusAiAudits
  const db = getAdminFirestore();
  const userRef = db.doc(`users/${auth.uid}`);
  const snap = await userRef.get();
  const data = (snap.exists ? snap.data() : {}) as {
    entitlementTier?: EntitlementTier;
    aiAuditsUsed?: number;
    bonusAiAudits?: number;
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

  if (tier === 'founder' || tier === 'vip' || tier === 'pro') {
    return {
      allowed: true,
      canUseAiCoach: true,
      tier,
      badgeLabel: tier === 'founder' ? 'Founder Immunity' : tier === 'vip' ? 'Founding Partner' : 'Executive Retainer',
      isExempt: true,
      aiAuditsUsed: used,
      freeLimit: FREE_AI_AUDITS_LIMIT,
      remainingFreeAudits: null,
    };
  }

  const bonus = Math.max(0, Number(data.bonusAiAudits ?? 0));
  const isAnonWithoutGift = Boolean(auth.isAnonymous && !auth.email && !storedEmail && bonus === 0);
  const baseLimit = isAnonWithoutGift ? ANONYMOUS_FREE_AI_AUDITS_LIMIT : FREE_AI_AUDITS_LIMIT;
  const effectiveLimit = baseLimit + bonus;

  // Do not block the initial __init__ greeting if they haven't exceeded their limit
  const remaining = Math.max(0, effectiveLimit - used);
  const allowed = options?.isInitGreeting ? used <= effectiveLimit : used < effectiveLimit;

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
    remainingFreeAudits: remaining,
  };
}

/**
 * Increments `aiAuditsUsed` on the user's Firestore doc after a successful
 * paid AI turn. Never increments for Founder, VIP, or Pro accounts, and
 * does not count the automatic `__init__` session greeting against the user's
 * free allowance.
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
    await userRef.set(
      {
        aiAuditsUsed: FieldValue.increment(1),
        lastAiAuditAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  } catch (err) {
    console.warn('[Entitlements] Failed to increment aiAuditsUsed:', err);
  }
}

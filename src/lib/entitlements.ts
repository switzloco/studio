/**
 * @fileOverview Entitlement, Credit Pack & Founder-Exempt Paywall Definitions.
 *
 * Philosophy (Seth Godin "Generous First" + Strict Unit-Economics Protection):
 *   1. The deterministic Daily Cockpit (VF v3.2 Taylor–Joule scoring, Alpert Eat Runway,
 *      Zero-AI 3-Day Nutritionist, 1-Tap Ticker Quick Log, Level Sprint Tracker, Wearable Sync,
 *      and CSV/JSON Ledger Export) is 100% FREE FOREVER for everyone.
 *   2. Active AI Coaching:
 *      - Anonymous guests get 5 complimentary AI preview turns before free sign-in (prevents
 *        incognito tab farming).
 *      - Signed-in free users get 15 complimentary AI Audits ("Opening Audit").
 *      - Friends & Family Shareable Credit Codes (e.g. FRIENDS25, FAMILY, BALLERS) grant a
 *        one-time +25 Bonus AI Audits (40 total, max ~$0.11 LLM cost) — once exhausted, users
 *        convert via Stripe Checkout ($12.99/mo or $79.99/yr).
 *   3. Founder Immunity: Nick Switzer (`nicholas.switzer@gmail.com`) and private master code
 *      `SWITZER` NEVER hit the paywall.
 */

export type EntitlementTier = 'founder' | 'vip' | 'pro' | 'free';

/** Generous free AI turn allowance for signed-in users before the AI Coach paywall appears. */
export const FREE_AI_AUDITS_LIMIT = 15;

/** Cap for unsigned-in anonymous guests to prevent incognito token farming. */
export const ANONYMOUS_FREE_AI_AUDITS_LIMIT = 5;

/** One-time bonus AI audits granted when redeeming a Friends & Family credit code/link. */
export const FRIENDS_BONUS_AI_AUDITS = 25;

/** Pricing constants for the Executive Retainer. */
export const CFO_PRICING = {
  monthlyPriceUsd: 12.99,
  annualPriceUsd: 79.99,
  annualMonthlyEquivalentUsd: 6.67,
  foundingPartnerLifetimeUsd: 199,
} as const;

/**
 * Permanent founder email allowlist (case-insensitive).
 * Nick's primary accounts are hardcoded so the paywall never applies to him,
 * even in local dev or before Firestore preferences finish loading.
 */
export const FOUNDER_EMAILS: ReadonlySet<string> = new Set([
  'nicholas.switzer@gmail.com',
  'nickswitzer1@gmail.com',
  'nickswitzer1@substack.com',
  'nick@cfofitness.app',
  'nick@thecfo.app',
]);

/**
 * Optional client-side check for whether the signed-in Firebase user is the founder.
 */
export function isFounderIdentity(user?: {
  uid?: string | null;
  email?: string | null;
  displayName?: string | null;
} | null): boolean {
  if (!user) return false;
  const email = user.email?.trim().toLowerCase();
  if (email && FOUNDER_EMAILS.has(email)) return true;

  const envUids = (process.env.NEXT_PUBLIC_CFO_FOUNDER_UIDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (user.uid && envUids.includes(user.uid)) return true;

  return false;
}

export interface EntitlementStatus {
  allowed: boolean;
  canUseAiCoach: boolean;
  tier: EntitlementTier;
  badgeLabel: string;
  isExempt: boolean;
  aiAuditsUsed: number;
  freeLimit: number;
  bonusAudits?: number;
  redeemedGiftCode?: string;
  requiresSignIn?: boolean;
  remainingFreeAudits: number | null; // null when unlimited (founder / vip / pro)
}

/**
 * Computes client-side entitlement status from user identity + Firestore HealthData.
 */
export function resolveClientEntitlement(
  user?: { uid?: string | null; email?: string | null; displayName?: string | null; isAnonymous?: boolean } | null,
  healthData?: {
    entitlementTier?: EntitlementTier;
    aiAuditsUsed?: number;
    bonusAiAudits?: number;
    redeemedFounderCode?: string;
    redeemedGiftCode?: string;
  } | null,
): EntitlementStatus {
  if (isFounderIdentity(user) || healthData?.entitlementTier === 'founder') {
    return {
      allowed: true,
      canUseAiCoach: true,
      tier: 'founder',
      badgeLabel: 'Founder Immunity',
      isExempt: true,
      aiAuditsUsed: healthData?.aiAuditsUsed ?? 0,
      freeLimit: FREE_AI_AUDITS_LIMIT,
      remainingFreeAudits: null,
    };
  }

  const storedTier: EntitlementTier =
    healthData?.entitlementTier && healthData.entitlementTier !== 'free'
      ? healthData.entitlementTier
      : healthData?.redeemedFounderCode
      ? 'vip'
      : 'free';

  if (storedTier === 'vip' || storedTier === 'pro') {
    return {
      allowed: true,
      canUseAiCoach: true,
      tier: storedTier,
      badgeLabel: storedTier === 'vip' ? 'Founding Partner' : 'Executive Retainer',
      isExempt: true,
      aiAuditsUsed: healthData?.aiAuditsUsed ?? 0,
      freeLimit: FREE_AI_AUDITS_LIMIT,
      remainingFreeAudits: null,
    };
  }

  const bonus = Math.max(0, Number(healthData?.bonusAiAudits ?? 0));
  const isAnonWithoutGift = Boolean(user?.isAnonymous && !user?.email && bonus === 0);
  const baseLimit = isAnonWithoutGift ? ANONYMOUS_FREE_AI_AUDITS_LIMIT : FREE_AI_AUDITS_LIMIT;
  const effectiveLimit = baseLimit + bonus;

  const used = Math.max(0, healthData?.aiAuditsUsed ?? 0);
  const remaining = Math.max(0, effectiveLimit - used);
  const allowed = used < effectiveLimit;
  return {
    allowed,
    canUseAiCoach: allowed,
    tier: 'free',
    badgeLabel: bonus > 0 ? `Partner Credit Pack (${remaining} left)` : 'Open Terminal',
    isExempt: false,
    aiAuditsUsed: used,
    freeLimit: effectiveLimit,
    bonusAudits: bonus,
    redeemedGiftCode: healthData?.redeemedGiftCode,
    requiresSignIn: !allowed && isAnonWithoutGift,
    remainingFreeAudits: remaining,
  };
}

/**
 * @fileOverview Entitlement, Smart Profitability Caps & Founder-Exempt Paywall Definitions.
 *
 * Unit-Economics & Profitability Guarantees:
 *   1. Zero-AI Cockpit (VF v3.2 Taylor–Joule scoring, Alpert Eat Runway, 3-Day Nutritionist,
 *      1-Tap Ticker Quick Log, Level Sprint Tracker, Wearable Sync, CSV/JSON Export):
 *      $0.00 server cost -> 100% FREE FOREVER for everyone.
 *   2. Customer Acquisition Caps (Free & Gift Tiers):
 *      - Unsigned-in Anonymous Guest: 3 AI turns max (~$0.009 total cost) before free sign-in.
 *      - Signed-in Free User: 10 AI turns max (~$0.03 total cost).
 *      - Friends & Family Credit Pack (`FRIENDS25`): +25 bonus AI turns (35 total). Turns 11-35
 *        auto-route to `gemini-2.5-flash-lite` (4x cheaper), capping total gift cost at ~$0.05/friend!
 *   3. Paying Subscriber Profitability Governor (`pro` / `vip`):
 *      - First 12 AI turns/day (and first 300/month) run on full `gemini-2.5-flash`.
 *      - Turns 13-30/day (and turns 301-450/month) auto-downshift to `gemini-2.5-flash-lite`.
 *      - Hard monthly fair-use ceiling of 450 AI turns/30-day cycle caps worst-case LLM cost at
 *        ~$1.08/month, guaranteeing >=82% net profit margin on Annual ($79.99/yr) and >=91% on Monthly ($12.99/mo).
 *   4. Founder Immunity: Nick Switzer (`nicholas.switzer@gmail.com`) is exempt from all caps.
 */

export type EntitlementTier = 'founder' | 'vip' | 'pro' | 'free';

/** Free AI turn allowance for signed-in users before the AI Coach paywall appears (~$0.03 CAC). */
export const FREE_AI_AUDITS_LIMIT = 10;

/** Cap for unsigned-in anonymous guests to prevent incognito token farming (~$0.009 max). */
export const ANONYMOUS_FREE_AI_AUDITS_LIMIT = 3;

/** One-time bonus AI audits granted when redeeming a Friends & Family credit code/link (~$0.05 total cost). */
export const FRIENDS_BONUS_AI_AUDITS = 25;

/** Daily threshold after which turns auto-downshift to gemini-2.5-flash-lite (4x cheaper). */
export const DAILY_HIGH_SPEED_TURNS = 12;

/** Monthly high-speed turns on gemini-2.5-flash before auto-downshifting to flash-lite. */
export const PRO_MONTHLY_HIGH_SPEED_TURNS = 300;

/** Hard 30-day fair-use ceiling for Pro/VIP accounts to guarantee >=82% net margin on Annual plans. */
export const PRO_MONTHLY_AI_AUDITS_CAP = 450;

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
  monthlyCapReached?: boolean;
  /** When set, routes should use this cost-optimized model for the turn to protect margins. */
  recommendedModel?: 'googleai/gemini-2.5-flash-lite';
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
    monthlyAiAuditsUsed?: number;
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
    const monthlyUsed = Math.max(0, Number(healthData?.monthlyAiAuditsUsed ?? 0));
    const withinMonthlyCap = monthlyUsed < PRO_MONTHLY_AI_AUDITS_CAP;
    return {
      allowed: withinMonthlyCap,
      canUseAiCoach: withinMonthlyCap,
      tier: storedTier,
      badgeLabel: storedTier === 'vip' ? 'Founding Partner' : 'Executive Retainer',
      isExempt: true,
      aiAuditsUsed: healthData?.aiAuditsUsed ?? 0,
      freeLimit: PRO_MONTHLY_AI_AUDITS_CAP,
      monthlyCapReached: !withinMonthlyCap,
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

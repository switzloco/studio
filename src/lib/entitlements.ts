/**
 * @fileOverview Entitlement & Founder-Exempt Paywall Definitions.
 *
 * Philosophy (Seth Godin "Generous First"):
 *   1. The deterministic Daily Cockpit (VF v3.2 Taylor–Joule scoring, Alpert Eat Runway,
 *      Zero-AI 3-Day Nutritionist, 1-Tap Ticker Quick Log, Level Sprint Tracker, Wearable Sync,
 *      and CSV/JSON Ledger Export) is 100% FREE FOREVER for everyone.
 *   2. Active AI Coaching (multimodal photo audits, USDA tool-calling agent, voice transcription,
 *      and Ledger Analyst) includes a generous 15 Free AI Audits ("Opening Audit") so every
 *      new user and Apple App Store reviewer gets real value before ever seeing a paywall.
 *   3. Founder & VIP Immunity: Nick Switzer (`nicholas.switzer@gmail.com`) and allowlisted
 *      founders/partners NEVER hit the paywall.
 */

export type EntitlementTier = 'founder' | 'vip' | 'pro' | 'free';

/** Generous free AI turn allowance before the AI Coach / Analyst paywall appears. */
export const FREE_AI_AUDITS_LIMIT = 15;

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

  // Also check NEXT_PUBLIC_CFO_FOUNDER_UIDS if configured
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
  remainingFreeAudits: number | null; // null when unlimited (founder / vip / pro)
}

/**
 * Computes client-side entitlement status from user identity + Firestore HealthData.
 */
export function resolveClientEntitlement(
  user?: { uid?: string | null; email?: string | null; displayName?: string | null } | null,
  healthData?: {
    entitlementTier?: EntitlementTier;
    aiAuditsUsed?: number;
    redeemedFounderCode?: string;
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

  const used = Math.max(0, healthData?.aiAuditsUsed ?? 0);
  const remaining = Math.max(0, FREE_AI_AUDITS_LIMIT - used);
  const allowed = used < FREE_AI_AUDITS_LIMIT;
  return {
    allowed,
    canUseAiCoach: allowed,
    tier: 'free',
    badgeLabel: 'Open Terminal',
    isExempt: false,
    aiAuditsUsed: used,
    freeLimit: FREE_AI_AUDITS_LIMIT,
    remainingFreeAudits: remaining,
  };
}

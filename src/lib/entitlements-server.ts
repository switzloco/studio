import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore, type VerifiedAuthToken } from '@/firebase/admin';
import {
  FOUNDER_EMAILS,
  FREE_AI_AUDITS_LIMIT,
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
 * Valid Founding Member / Friend-of-Nick invite codes (case-insensitive).
 * Configurable via CFO_FOUNDER_CODES env var, with built-in tribe defaults.
 */
export function getValidFounderCodes(): Set<string> {
  const defaults = [
    'SWITZER',
    'NICKVIP',
    'BEERBELLYBALLERS',
    'CFOPARTNER',
    'TAYLORJOULE',
    'BODYSPEC',
  ];
  const fromEnv = (process.env.CFO_FOUNDER_CODES || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return new Set([...defaults, ...fromEnv]);
}

/**
 * Server-authoritative entitlement check before running paid Gemini AI flows.
 *
 * - Founder (`nicholas.switzer@gmail.com`) is ALWAYS exempt and automatically
 *   stamped with `entitlementTier: 'founder'` in Firestore if not already set.
 * - `vip` and `pro` users are ALWAYS exempt.
 * - `free` users receive `FREE_AI_AUDITS_LIMIT` (15) complimentary AI turns.
 */
export async function checkServerEntitlement(
  auth: VerifiedAuthToken,
  options?: { isInitGreeting?: boolean },
): Promise<EntitlementStatus> {
  // 1. Fast-path: Founder identity via verified Firebase Auth token
  if (isServerFounderIdentity(auth)) {
    // Best-effort fire-and-forget stamp so the client UI also sees 'founder' even if email isn't checked
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

  // 2. Read user doc for stored entitlementTier and aiAuditsUsed
  const db = getAdminFirestore();
  const userRef = db.doc(`users/${auth.uid}`);
  const snap = await userRef.get();
  const data = (snap.exists ? snap.data() : {}) as {
    entitlementTier?: EntitlementTier;
    aiAuditsUsed?: number;
    redeemedFounderCode?: string;
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

  // Do not block the initial __init__ greeting if they haven't exceeded their limit
  const remaining = Math.max(0, FREE_AI_AUDITS_LIMIT - used);
  const allowed = options?.isInitGreeting ? used <= FREE_AI_AUDITS_LIMIT : used < FREE_AI_AUDITS_LIMIT;

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

/**
 * Increments `aiAuditsUsed` on the user's Firestore doc after a successful
 * paid AI turn. Never increments for Founder, VIP, or Pro accounts, and
 * skips `__init__` auto-greetings so orientation does not burn user credits.
 */
export async function recordAiAuditTurn(
  auth: VerifiedAuthToken,
  isInitOrTier?: boolean | EntitlementTier,
  options?: { isInitGreeting?: boolean },
): Promise<void> {
  const isInitGreeting =
    typeof isInitOrTier === 'boolean' ? isInitOrTier : Boolean(options?.isInitGreeting);
  if (isInitGreeting) return;
  if (isInitOrTier === 'founder' || isInitOrTier === 'vip' || isInitOrTier === 'pro') return;
  if (isServerFounderIdentity(auth)) return;

  try {
    const db = getAdminFirestore();
    const userRef = db.doc(`users/${auth.uid}`);
    const snap = await userRef.get();
    const data = (snap.exists ? snap.data() : {}) as {
      entitlementTier?: EntitlementTier;
      redeemedFounderCode?: string;
    };
    if (
      data.entitlementTier === 'founder' ||
      data.entitlementTier === 'vip' ||
      data.entitlementTier === 'pro' ||
      Boolean(data.redeemedFounderCode)
    ) {
      return;
    }

    await userRef.set(
      {
        aiAuditsUsed: FieldValue.increment(1),
        lastAiAuditAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  } catch (err) {
    console.warn('[recordAiAuditTurn] non-fatal increment failure:', err);
  }
}

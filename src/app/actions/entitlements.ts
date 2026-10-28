'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore, verifyIdTokenString } from '@/firebase/admin';
import {
  FRIENDS_BONUS_AI_AUDITS,
  checkServerEntitlement,
  getValidCreditPackCodes,
  getValidFounderCodes,
} from '@/lib/entitlements-server';

/**
 * Redeems either:
 *   1. A Shareable Friends & Family Credit Code (e.g. FRIENDS25, FAMILY, BALLERS, BEERBELLYBALLERS)
 *      -> Grants a ONE-TIME +25 Bonus AI Audits (`bonusAiAudits: 25`), capping LLM exposure at ~$0.11
 *         while letting friends & family share codes freely.
 *   2. A Master Founder Code (e.g. SWITZER) -> Grants VIP immunity.
 */
export async function redeemFounderCodeAction(
  idToken: string,
  rawCode: string,
): Promise<{
  success: boolean;
  tier?: 'vip' | 'founder' | 'credit_pack';
  bonusAdded?: number;
  message?: string;
  error?: string;
}> {
  const auth = await verifyIdTokenString(idToken);
  if (!auth) {
    return { success: false, error: 'Please sign in to redeem a credit code.' };
  }

  const cleanCode = (rawCode || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!cleanCode) {
    return { success: false, error: 'Enter a valid code.' };
  }

  const founderCodes = getValidFounderCodes();
  const creditCodes = getValidCreditPackCodes();

  const isMasterFounderCode = founderCodes.has(cleanCode);
  const isCreditPackCode = creditCodes.has(cleanCode);

  if (!isMasterFounderCode && !isCreditPackCode) {
    return {
      success: false,
      error: 'Code not recognized. Try FRIENDS25 or ask Nick for a Friends & Family credit link.',
    };
  }

  try {
    const db = getAdminFirestore();
    const userRef = db.doc(`users/${auth.uid}`);

    if (isMasterFounderCode) {
      await userRef.set(
        {
          entitlementTier: 'vip',
          redeemedFounderCode: cleanCode,
          entitlementUpdatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return {
        success: true,
        tier: 'vip',
        message: 'Founder VIP access unlocked.',
      };
    }

    // Credit pack code: one-time +25 bonus AI audits per user (cannot be stacked repeatedly)
    const snap = await userRef.get();
    const existing = snap.exists ? snap.data() : undefined;
    if (existing?.redeemedGiftCode) {
      return {
        success: false,
        error: `You already redeemed a Friends & Family credit pack (${existing.redeemedGiftCode}). Retain the AI CFO below for unlimited access!`,
      };
    }

    await userRef.set(
      {
        bonusAiAudits: FRIENDS_BONUS_AI_AUDITS,
        redeemedGiftCode: cleanCode,
        entitlementUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return {
      success: true,
      tier: 'credit_pack',
      bonusAdded: FRIENDS_BONUS_AI_AUDITS,
      message: `+${FRIENDS_BONUS_AI_AUDITS} Friends & Family AI CFO credits added to your account!`,
    };
  } catch (err: any) {
    console.error('[redeemFounderCodeAction] Failed:', err);
    return { success: false, error: 'Could not activate code. Please try again.' };
  }
}

/**
 * Server action to fetch authoritative entitlement status for the current user.
 */
export async function getMyEntitlementAction(idToken: string) {
  const auth = await verifyIdTokenString(idToken);
  if (!auth) return null;
  return checkServerEntitlement(auth);
}

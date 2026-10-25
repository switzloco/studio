'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore, verifyIdTokenString } from '@/firebase/admin';
import { getValidFounderCodes, checkServerEntitlement } from '@/lib/entitlements-server';
import { sendAdminReportEmail } from '@/lib/admin-email';

/**
 * Redeems a Founding Member / Friend-of-Nick invite code (e.g., SWITZER, BEERBELLYBALLERS)
 * and permanently unlocks VIP immunity on the user's Firestore portfolio.
 */
export async function redeemFounderCodeAction(
  idToken: string,
  rawCode: string,
): Promise<{ success: boolean; tier?: 'vip' | 'founder'; error?: string }> {
  const auth = await verifyIdTokenString(idToken);
  if (!auth) {
    return { success: false, error: 'Please sign in to redeem a partner code.' };
  }

  const cleanCode = (rawCode || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!cleanCode) {
    return { success: false, error: 'Enter a valid code.' };
  }

  const validCodes = getValidFounderCodes();
  if (!validCodes.has(cleanCode)) {
    return {
      success: false,
      error: 'Code not recognized. Ask Nick for a Founding Member code or use the direct request button below.',
    };
  }

  try {
    const db = getAdminFirestore();
    await db.doc(`users/${auth.uid}`).set(
      {
        entitlementTier: 'vip',
        redeemedFounderCode: cleanCode,
        entitlementUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { success: true, tier: 'vip' };
  } catch (err: any) {
    console.error('[redeemFounderCodeAction] Failed:', err);
    return { success: false, error: 'Could not activate code. Please try again.' };
  }
}

/**
 * Activates a CFO Pro Retainer plan ('monthly' | 'annual' | 'founding_partner')
 * or records a direct Founding Partner access request to Nick.
 */
export async function activateProRetainerAction(
  idToken: string,
  plan: 'monthly' | 'annual' | 'founding_partner',
  noteOrEmail?: string,
): Promise<{ success: boolean; checkoutUrl?: string; activatedDirectly?: boolean; error?: string }> {
  const auth = await verifyIdTokenString(idToken);
  if (!auth) {
    return { success: false, error: 'Authentication required.' };
  }

  // If Stripe Payment Links are configured in env, return the external checkout URL
  const stripeUrl =
    plan === 'annual'
      ? process.env.NEXT_PUBLIC_STRIPE_ANNUAL_URL
      : plan === 'monthly'
        ? process.env.NEXT_PUBLIC_STRIPE_MONTHLY_URL
        : process.env.NEXT_PUBLIC_STRIPE_FOUNDING_URL;

  const db = getAdminFirestore();

  // Log the retainer request and grant immediate Pro access during Founding Member launch
  // so no high-intent user hits a dead end before Stripe/RevenueCat webhooks are live,
  // while notifying Nick immediately via email.
  try {
    await db.doc(`users/${auth.uid}`).set(
      {
        entitlementTier: 'pro',
        subscriptionPlan: plan,
        entitlementUpdatedAt: FieldValue.serverTimestamp(),
        ...(auth.email ? { email: auth.email } : {}),
      },
      { merge: true },
    );

    const userEmail = auth.email || noteOrEmail || 'Anonymous User';
    void sendAdminReportEmail(
      'nicholas.switzer@gmail.com',
      `[the CFO] New Pro Retainer Activated (${plan.toUpperCase()}) — ${userEmail}`,
      `<div style="font-family:sans-serif;max-width:600px;">
        <h2>New CFO Pro Retainer Activated</h2>
        <p><strong>UID:</strong> <code>${auth.uid}</code></p>
        <p><strong>Email / Contact:</strong> ${userEmail}</p>
        <p><strong>Selected Plan:</strong> ${plan}</p>
        ${noteOrEmail ? `<p><strong>Note:</strong> ${noteOrEmail}</p>` : ''}
      </div>`,
    ).catch(() => {});

    if (stripeUrl) {
      return { success: true, checkoutUrl: stripeUrl, activatedDirectly: true };
    }
    return { success: true, activatedDirectly: true };
  } catch (err: any) {
    console.error('[activateProRetainerAction] Error:', err);
    return { success: false, error: err?.message || 'Could not activate retainer.' };
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

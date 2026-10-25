import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminAuth, getAdminFirestore } from '@/firebase/admin';
import { getStripeWebhookSecret, verifyStripeWebhookSignature } from '@/lib/stripe-server';

/**
 * Resolves a Firebase UID from Stripe metadata or by querying `stripeCustomerId`.
 */
async function resolveFirebaseUid(
  explicitUid: string | undefined | null,
  stripeCustomerId: string | undefined | null,
): Promise<string | null> {
  if (explicitUid) return explicitUid;
  if (!stripeCustomerId) return null;

  const db = getAdminFirestore();
  const snap = await db
    .collection('users')
    .where('stripeCustomerId', '==', stripeCustomerId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].id;
}

export async function POST(req: NextRequest) {
  const webhookSecret = getStripeWebhookSecret();
  if (!webhookSecret) {
    console.error('[StripeWebhook] Missing STRIPE_WEBHOOK_SECRET');
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  let event;
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('stripe-signature');
    event = verifyStripeWebhookSignature(rawBody, signature, webhookSecret);
  } catch (err: any) {
    console.error('[StripeWebhook] Signature verification failed:', err?.message ?? err);
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${err?.message ?? 'invalid'}` },
      { status: 400 },
    );
  }

  const db = getAdminFirestore();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const customerId = session.customer ? String(session.customer) : null;
        const subscriptionId = session.subscription ? String(session.subscription) : null;
        const stripeEmail: string | null =
          session.customer_details?.email || session.customer_email || null;
        const plan = session.metadata?.plan || 'annual';

        const uid = await resolveFirebaseUid(
          session.client_reference_id || session.metadata?.firebaseUid,
          customerId,
        );

        if (!uid) {
          console.warn('[StripeWebhook] checkout.session.completed could not resolve Firebase UID', {
            sessionId: session.id,
            customerId,
          });
          break;
        }

        // Layer 2 Safety Net: if the Firebase Auth user has no email on file, bind the
        // Stripe Checkout email so the account is always recoverable.
        if (stripeEmail) {
          try {
            const authUser = await getAdminAuth().getUser(uid);
            if (!authUser.email) {
              await getAdminAuth().updateUser(uid, { email: stripeEmail });
            }
          } catch (authErr) {
            console.warn('[StripeWebhook] non-fatal email bind skipped:', authErr);
          }
        }

        await db.doc(`users/${uid}`).set(
          {
            entitlementTier: 'pro',
            subscriptionPlan: plan,
            subscriptionStatus: 'active',
            cancelAtPeriodEnd: false,
            ...(customerId ? { stripeCustomerId: customerId } : {}),
            ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
            ...(stripeEmail ? { email: stripeEmail } : {}),
            retainerActivatedAt: FieldValue.serverTimestamp(),
            proUpdatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const customerId = sub.customer ? String(sub.customer) : null;
        const uid = await resolveFirebaseUid(sub.metadata?.firebaseUid, customerId);
        if (!uid) break;

        const status = String(sub.status || '');
        const isActive = status === 'active' || status === 'trialing';

        const userSnap = await db.doc(`users/${uid}`).get();
        const existing = (userSnap.exists ? userSnap.data() : {}) as {
          entitlementTier?: string;
          redeemedFounderCode?: string;
        };

        // Never downgrade a Founder or VIP partner
        const preserveExempt =
          existing.entitlementTier === 'founder' ||
          existing.entitlementTier === 'vip' ||
          Boolean(existing.redeemedFounderCode);

        await db.doc(`users/${uid}`).set(
          {
            entitlementTier: preserveExempt ? existing.entitlementTier : isActive ? 'pro' : 'free',
            subscriptionStatus: status,
            cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
            currentPeriodEnd: sub.current_period_end ? Number(sub.current_period_end) * 1000 : null,
            stripeSubscriptionId: String(sub.id),
            ...(customerId ? { stripeCustomerId: customerId } : {}),
            proUpdatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const customerId = sub.customer ? String(sub.customer) : null;
        const uid = await resolveFirebaseUid(sub.metadata?.firebaseUid, customerId);
        if (!uid) break;

        const userSnap = await db.doc(`users/${uid}`).get();
        const existing = (userSnap.exists ? userSnap.data() : {}) as {
          entitlementTier?: string;
          redeemedFounderCode?: string;
        };

        const preserveExempt =
          existing.entitlementTier === 'founder' ||
          existing.entitlementTier === 'vip' ||
          Boolean(existing.redeemedFounderCode);

        await db.doc(`users/${uid}`).set(
          {
            entitlementTier: preserveExempt ? existing.entitlementTier : 'free',
            subscriptionStatus: 'canceled',
            cancelAtPeriodEnd: false,
            proUpdatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error('[StripeWebhook] Handler error:', err?.message ?? err);
    return NextResponse.json(
      { error: err?.message ?? 'Webhook handler error' },
      { status: 500 },
    );
  }
}

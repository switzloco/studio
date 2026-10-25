import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore, verifyAuthHeaderDetails } from '@/firebase/admin';
import { retrieveStripeCheckoutSession } from '@/lib/stripe-server';

export async function POST(req: NextRequest) {
  const auth = await verifyAuthHeaderDetails(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
    if (!sessionId || !sessionId.startsWith('cs_')) {
      return NextResponse.json({ error: 'Invalid session_id' }, { status: 400 });
    }

    const session = await retrieveStripeCheckoutSession(sessionId);
    const sessionUid = session.client_reference_id || session.metadata?.firebaseUid;
    if (sessionUid !== auth.uid) {
      return NextResponse.json({ error: 'Session UID mismatch' }, { status: 403 });
    }

    const isPaid = session.payment_status === 'paid' || session.status === 'complete';
    if (!isPaid) {
      return NextResponse.json({ error: 'Checkout session is not yet paid' }, { status: 400 });
    }

    const customerId = session.customer ? String(session.customer) : null;
    const subscriptionId = session.subscription ? String(session.subscription) : null;
    const plan = session.metadata?.plan || 'annual';

    const db = getAdminFirestore();
    await db.doc(`users/${auth.uid}`).set(
      {
        entitlementTier: 'pro',
        subscriptionPlan: plan,
        subscriptionStatus: 'active',
        cancelAtPeriodEnd: false,
        ...(customerId ? { stripeCustomerId: customerId } : {}),
        ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
        retainerActivatedAt: FieldValue.serverTimestamp(),
        proUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return NextResponse.json({ success: true, tier: 'pro', plan });
  } catch (err: any) {
    console.error('[StripeVerifySession] Error:', err?.message ?? err);
    return NextResponse.json(
      { error: err?.message ?? 'Could not verify Stripe session' },
      { status: 500 },
    );
  }
}

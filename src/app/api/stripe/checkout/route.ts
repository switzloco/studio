import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, verifyAuthHeaderDetails } from '@/firebase/admin';
import {
  createStripeCheckoutSession,
  type StripeCheckoutPlan,
} from '@/lib/stripe-server';

export async function POST(req: NextRequest) {
  const auth = await verifyAuthHeaderDetails(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Layer 1 Orphaned-Retainer Guard: never let an unlinked anonymous Firebase user
  // pay on Stripe before binding their identity, or clearing browser storage would
  // orphan their paid subscription.
  if (auth.isAnonymous) {
    return NextResponse.json(
      {
        code: 'ACCOUNT_LINK_REQUIRED',
        error:
          'Partner, link your Google account first so your paid retainer and ledger travel across your phone and desktop.',
      },
      { status: 400 },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const rawPlan = body?.plan;
    const plan: StripeCheckoutPlan =
      rawPlan === 'monthly' || rawPlan === 'lifetime' ? rawPlan : 'annual';

    const db = getAdminFirestore();
    const userSnap = await db.doc(`users/${auth.uid}`).get();
    const userData = (userSnap.exists ? userSnap.data() : {}) as {
      stripeCustomerId?: string;
      email?: string;
    };

    const origin =
      process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ||
      req.headers.get('origin') ||
      'https://cfofitness.app';

    const session = await createStripeCheckoutSession({
      uid: auth.uid,
      email: auth.email || userData.email || null,
      stripeCustomerId: userData.stripeCustomerId || null,
      plan,
      origin,
    });

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (err: any) {
    if (err?.message === 'STRIPE_NOT_CONFIGURED') {
      return NextResponse.json(
        {
          code: 'STRIPE_NOT_CONFIGURED',
          error:
            'Stripe checkout is not configured yet (set STRIPE_SECRET_KEY in environment). You can enter a Founding Partner code below in the meantime.',
        },
        { status: 503 },
      );
    }
    console.error('[StripeCheckout] Error:', err?.message ?? err);
    return NextResponse.json(
      { error: err?.message ?? 'Could not initialize Stripe Checkout' },
      { status: 500 },
    );
  }
}

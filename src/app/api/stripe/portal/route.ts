import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, verifyAuthHeaderDetails } from '@/firebase/admin';
import { createStripeBillingPortalSession } from '@/lib/stripe-server';

export async function POST(req: NextRequest) {
  const auth = await verifyAuthHeaderDetails(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getAdminFirestore();
    const userSnap = await db.doc(`users/${auth.uid}`).get();
    const userData = (userSnap.exists ? userSnap.data() : {}) as {
      stripeCustomerId?: string;
    };

    if (!userData.stripeCustomerId) {
      return NextResponse.json(
        { error: 'No Stripe billing record found for this account.' },
        { status: 404 },
      );
    }

    const origin =
      process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ||
      req.headers.get('origin') ||
      'https://cfofitness.app';

    const portal = await createStripeBillingPortalSession({
      stripeCustomerId: userData.stripeCustomerId,
      returnUrl: `${origin}/`,
    });

    return NextResponse.json({ url: portal.url });
  } catch (err: any) {
    console.error('[StripePortal] Error:', err?.message ?? err);
    return NextResponse.json(
      { error: err?.message ?? 'Could not open Stripe Billing Portal' },
      { status: 500 },
    );
  }
}

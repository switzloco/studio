import crypto from 'node:crypto';
import fs from 'node:fs';
import { CFO_PRICING } from './entitlements';

const LOCAL_DEV_KEY_FILES = [
  'C:/dev/stripekeys.txt',
  'C:/dev/Stripe Keys.txt',
  'C:/dev/Stripe Keys',
  'C:/dev/stripe.txt',
];

function readLocalDevStripeFile(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const filePath of LOCAL_DEV_KEY_FILES) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, 'utf8');
      if (!content.trim()) continue;
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eqIdx = line.indexOf('=');
        if (eqIdx !== -1) {
          const k = line.slice(0, eqIdx).trim();
          const v = line.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
          if (k && v) out[k] = v;
        } else if (/^(sk_|rk_)/.test(line)) {
          out.STRIPE_SECRET = line;
        } else if (/^pk_/.test(line)) {
          out.STRIPE_PUBLISHABLE_KEY = line;
        } else if (/^whsec_/.test(line)) {
          out.STRIPE_WEBHOOK_SECRET = line;
        }
      }
    } catch {
      // ignore fs errors in production/serverless environments
    }
  }
  return out;
}

export type StripeCheckoutPlan = 'annual' | 'monthly' | 'lifetime';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const WEBHOOK_TOLERANCE_SECONDS = 300; // 5 minutes

export interface StripeEvent<T = Record<string, any>> {
  id: string;
  type: string;
  created: number;
  data: {
    object: T;
  };
}

/**
 * Encodes nested key-value pairs as `application/x-www-form-urlencoded` for the Stripe REST API.
 */
export function encodeStripeForm(data: Record<string, any>, prefix = ''): URLSearchParams {
  const params = new URLSearchParams();

  const append = (key: string, value: any) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        append(`${key}[${index}]`, item);
      });
    } else if (typeof value === 'object') {
      for (const [subKey, subVal] of Object.entries(value)) {
        append(`${key}[${subKey}]`, subVal);
      }
    } else {
      params.append(key, String(value));
    }
  };

  for (const [k, v] of Object.entries(data)) {
    append(prefix ? `${prefix}[${k}]` : k, v);
  }
  return params;
}

/**
 * Verifies a Stripe `Stripe-Signature` header (`t=...,v1=...`) against the raw request body
 * using HMAC-SHA256 and constant-time comparison.
 */
export function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): StripeEvent {
  if (!signatureHeader) {
    throw new Error('Missing stripe-signature header');
  }
  if (!webhookSecret) {
    throw new Error('Missing STRIPE_WEBHOOK_SECRET');
  }

  const parts = signatureHeader.split(',').map((p) => p.trim());
  const timestampPart = parts.find((p) => p.startsWith('t='));
  const v1Signatures = parts
    .filter((p) => p.startsWith('v1='))
    .map((p) => p.slice(3))
    .filter(Boolean);

  if (!timestampPart || v1Signatures.length === 0) {
    throw new Error('Invalid stripe-signature header format');
  }

  const timestamp = Number(timestampPart.slice(2));
  if (!Number.isFinite(timestamp)) {
    throw new Error('Invalid stripe-signature timestamp');
  }

  if (Math.abs(nowSeconds - timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
    throw new Error('Stripe webhook timestamp outside tolerance window');
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const expectedHex = crypto
    .createHmac('sha256', webhookSecret)
    .update(signedPayload, 'utf8')
    .digest('hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');

  const matched = v1Signatures.some((sigHex) => {
    try {
      const sigBuf = Buffer.from(sigHex, 'hex');
      if (sigBuf.length !== expectedBuf.length) return false;
      return crypto.timingSafeEqual(sigBuf, expectedBuf);
    } catch {
      return false;
    }
  });

  if (!matched) {
    throw new Error('Stripe webhook signature verification failed');
  }

  return JSON.parse(rawBody) as StripeEvent;
}

/**
 * Builds the Stripe Checkout Session form parameters.
 * Uses configured `STRIPE_PRICE_*_ID` env vars if present, or falls back to inline `price_data`
 * so Stripe Checkout works immediately with just `STRIPE_SECRET_KEY`.
 */
export function buildCheckoutSessionParams(input: {
  uid: string;
  email?: string | null;
  stripeCustomerId?: string | null;
  plan: StripeCheckoutPlan;
  origin: string;
}): Record<string, any> {
  const { uid, email, stripeCustomerId, plan, origin } = input;
  const isLifetime = plan === 'lifetime';
  const mode = isLifetime ? 'payment' : 'subscription';

  const configuredPriceId =
    plan === 'annual'
      ? process.env.STRIPE_PRICE_ANNUAL_ID
      : plan === 'monthly'
      ? process.env.STRIPE_PRICE_MONTHLY_ID
      : process.env.STRIPE_PRICE_LIFETIME_ID;

  const lineItem = configuredPriceId
    ? { price: configuredPriceId, quantity: 1 }
    : plan === 'annual'
    ? {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(CFO_PRICING.annualPriceUsd * 100), // 7999 ($79.99/yr)
          recurring: { interval: 'year' },
          product_data: {
            name: 'the CFO — Annual Audit Partner Retainer',
            description:
              'Unlimited Multimodal AI Coach, Voice Dictation, and Ledger Analyst. Cancel in 1 click anytime.',
            tax_code: 'txcd_10103001',
          },
        },
      }
    : plan === 'monthly'
    ? {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(CFO_PRICING.monthlyPriceUsd * 100), // 1299 ($12.99/mo)
          recurring: { interval: 'month' },
          product_data: {
            name: 'the CFO — Monthly Executive Retainer',
            description:
              'Unlimited Multimodal AI Coach, Voice Dictation, and Ledger Analyst. Cancel in 1 click anytime.',
            tax_code: 'txcd_10103001',
          },
        },
      }
    : {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(CFO_PRICING.foundingPartnerLifetimeUsd * 100), // 19900 ($199 once)
          product_data: {
            name: 'the CFO — Founding Partner Lifetime Seat',
            description:
              'Lifetime unlimited access to the AI CFO, Voice Dictation, and Ledger Analyst.',
            tax_code: 'txcd_10103001',
          },
        },
      };

  const payload: Record<string, any> = {
    mode,
    client_reference_id: uid,
    allow_promotion_codes: 'true',
    line_items: [lineItem],
    metadata: {
      firebaseUid: uid,
      plan,
    },
    success_url: `${origin}/?checkout=success&plan=${encodeURIComponent(plan)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/?checkout=cancelled`,
  };

  if (stripeCustomerId) {
    payload.customer = stripeCustomerId;
  } else if (email) {
    payload.customer_email = email;
  }

  if (mode === 'subscription') {
    payload.subscription_data = {
      metadata: {
        firebaseUid: uid,
        plan,
      },
    };
  }

  return payload;
}

export function getStripeSecretKey(): string | undefined {
  const fromEnv = (process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET)?.trim();
  if (fromEnv) return fromEnv;
  const fromDevFile = readLocalDevStripeFile();
  return (fromDevFile.STRIPE_SECRET_KEY || fromDevFile.STRIPE_SECRET)?.trim() || undefined;
}

export function getStripePublishableKey(): string | undefined {
  const fromEnv = (
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || process.env.STRIPE_PUBLISHABLE_KEY
  )?.trim();
  if (fromEnv) return fromEnv;
  const fromDevFile = readLocalDevStripeFile();
  return (
    fromDevFile.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || fromDevFile.STRIPE_PUBLISHABLE_KEY
  )?.trim() || undefined;
}

export function getStripeWebhookSecret(): string | undefined {
  const fromEnv = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (fromEnv) return fromEnv;
  const fromDevFile = readLocalDevStripeFile();
  return fromDevFile.STRIPE_WEBHOOK_SECRET?.trim() || undefined;
}

/**
 * Calls Stripe REST API to create a Hosted Checkout Session.
 */
export async function createStripeCheckoutSession(input: {
  uid: string;
  email?: string | null;
  stripeCustomerId?: string | null;
  plan: StripeCheckoutPlan;
  origin: string;
}): Promise<{ id: string; url: string }> {
  const secretKey = getStripeSecretKey();
  if (!secretKey) {
    throw new Error('STRIPE_NOT_CONFIGURED');
  }

  const params = encodeStripeForm(buildCheckoutSessionParams(input));
  const res = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const data = await res.json();
  if (!res.ok || !data.url) {
    const msg = data?.error?.message || `Stripe Checkout failed (${res.status})`;
    throw new Error(msg);
  }

  return { id: data.id, url: data.url };
}

/**
 * Calls Stripe REST API to create a Customer Billing Portal session for 1-click cancellation / plan management.
 */
export async function createStripeBillingPortalSession(input: {
  stripeCustomerId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  const secretKey = getStripeSecretKey();
  if (!secretKey) {
    throw new Error('STRIPE_NOT_CONFIGURED');
  }

  const params = encodeStripeForm({
    customer: input.stripeCustomerId,
    return_url: input.returnUrl,
  });

  const res = await fetch(`${STRIPE_API_BASE}/billing_portal/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const data = await res.json();
  if (!res.ok || !data.url) {
    const msg = data?.error?.message || `Stripe Billing Portal failed (${res.status})`;
    throw new Error(msg);
  }

  return { url: data.url };
}

/**
 * Retrieves a Checkout Session from Stripe to confirm payment immediately upon redirect.
 */
export async function retrieveStripeCheckoutSession(sessionId: string): Promise<Record<string, any>> {
  const secretKey = getStripeSecretKey();
  if (!secretKey) {
    throw new Error('STRIPE_NOT_CONFIGURED');
  }

  const res = await fetch(
    `${STRIPE_API_BASE}/checkout/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
      },
    },
  );

  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || `Failed to retrieve Checkout Session (${res.status})`;
    throw new Error(msg);
  }

  return data;
}


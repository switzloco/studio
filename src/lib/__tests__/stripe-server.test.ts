import crypto from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  verifyStripeWebhookSignature,
  buildCheckoutSessionParams,
  encodeStripeForm,
} from '../stripe-server';

describe('Stripe Server Helpers & Webhook Verification', () => {
  const secret = 'whsec_test_secret_12345';

  it('verifies a valid Stripe webhook HMAC-SHA256 signature', () => {
    const now = 1760000000;
    const rawBody = JSON.stringify({
      id: 'evt_123',
      type: 'checkout.session.completed',
      created: now,
      data: {
        object: {
          id: 'cs_test_1',
          client_reference_id: 'user-uid-99',
          customer: 'cus_abc',
          subscription: 'sub_xyz',
        },
      },
    });

    const sigHex = crypto
      .createHmac('sha256', secret)
      .update(`${now}.${rawBody}`, 'utf8')
      .digest('hex');

    const header = `t=${now},v1=${sigHex}`;
    const event = verifyStripeWebhookSignature(rawBody, header, secret, now + 10);

    expect(event.id).toBe('evt_123');
    expect(event.type).toBe('checkout.session.completed');
    expect(event.data.object.client_reference_id).toBe('user-uid-99');
  });

  it('rejects a tampered webhook body or invalid signature', () => {
    const now = 1760000000;
    const rawBody = JSON.stringify({ id: 'evt_123', type: 'checkout.session.completed', created: now, data: { object: {} } });
    const badHeader = `t=${now},v1=${'a'.repeat(64)}`;

    expect(() => verifyStripeWebhookSignature(rawBody, badHeader, secret, now)).toThrow(
      /signature verification failed/i,
    );
  });

  it('rejects a replay attack outside the 5-minute timestamp window', () => {
    const oldTimestamp = 1760000000;
    const rawBody = JSON.stringify({ id: 'evt_old', type: 'checkout.session.completed', created: oldTimestamp, data: { object: {} } });
    const sigHex = crypto
      .createHmac('sha256', secret)
      .update(`${oldTimestamp}.${rawBody}`, 'utf8')
      .digest('hex');

    const header = `t=${oldTimestamp},v1=${sigHex}`;
    expect(() =>
      verifyStripeWebhookSignature(rawBody, header, secret, oldTimestamp + 601),
    ).toThrow(/outside tolerance window/i);
  });

  it('builds annual subscription checkout params with firebaseUid metadata and inline price_data fallback', () => {
    const params = buildCheckoutSessionParams({
      uid: 'uid-nick-test',
      email: 'partner@example.com',
      plan: 'annual',
      origin: 'https://cfofitness.app',
    });

    expect(params.mode).toBe('subscription');
    expect(params.client_reference_id).toBe('uid-nick-test');
    expect(params.metadata.firebaseUid).toBe('uid-nick-test');
    expect(params.subscription_data.metadata.firebaseUid).toBe('uid-nick-test');
    expect(params.line_items[0].price_data.unit_amount).toBe(7999);
    expect(params.line_items[0].price_data.recurring.interval).toBe('year');

    const encoded = encodeStripeForm(params);
    expect(encoded.get('client_reference_id')).toBe('uid-nick-test');
    expect(encoded.get('subscription_data[metadata][firebaseUid]')).toBe('uid-nick-test');
    expect(encoded.get('line_items[0][price_data][unit_amount]')).toBe('7999');
  });

  it('builds one-time payment checkout params for the Founding Partner lifetime pass', () => {
    const params = buildCheckoutSessionParams({
      uid: 'uid-lifetime',
      stripeCustomerId: 'cus_existing',
      plan: 'lifetime',
      origin: 'https://cfofitness.app',
    });

    expect(params.mode).toBe('payment');
    expect(params.customer).toBe('cus_existing');
    expect(params.subscription_data).toBeUndefined();
    expect(params.line_items[0].price_data.unit_amount).toBe(19900);
  });
});

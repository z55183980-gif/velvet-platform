import test from 'node:test';
import assert from 'node:assert/strict';
import { createStripeRefund, isFullStripeRefund } from '../src/payments/stripe-refund';

test('isFullStripeRefund requires covering charge/order minor units', () => {
  assert.equal(
    isFullStripeRefund({
      amountRefundedMinor: 500,
      chargeAmountMinor: 999,
      orderAmountMinor: 999,
    }),
    false,
  );
  assert.equal(
    isFullStripeRefund({
      amountRefundedMinor: 999,
      chargeAmountMinor: 999,
      orderAmountMinor: 999,
    }),
    true,
  );
  assert.equal(
    isFullStripeRefund({
      refundAmountMinor: 999,
      orderAmountMinor: 999,
    }),
    true,
  );
  // Legacy flat payload without amounts → treat as full (dev webhooks)
  assert.equal(isFullStripeRefund({}), true);
});

test('createStripeRefund posts to Stripe with idempotency + payment_intent', async () => {
  const prev = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  try {
    let sawAuth = false;
    let sawIdem = false;
    let body = '';
    const fetchImpl = (async (_url: any, init: any) => {
      sawAuth = String(init.headers.Authorization || '').includes('sk_test_dummy');
      sawIdem = init.headers['Idempotency-Key'] === 'velvet-refund:ORD1';
      body = String(init.body || '');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 're_123',
          status: 'succeeded',
          amount: 299,
          currency: 'usd',
        }),
      } as any;
    }) as typeof fetch;

    const result = await createStripeRefund({
      paymentIntentOrChargeId: 'pi_abc',
      amountMinor: 299,
      idempotencyKey: 'velvet-refund:ORD1',
      fetchImpl,
    });
    assert.equal(result.refundId, 're_123');
    assert.equal(result.alreadyRefunded, false);
    assert.equal(sawAuth, true);
    assert.equal(sawIdem, true);
    assert.match(body, /payment_intent=pi_abc/);
    assert.match(body, /amount=299/);
  } finally {
    if (prev === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = prev;
  }
});

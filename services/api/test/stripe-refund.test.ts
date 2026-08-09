import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStripeRefund,
  isFullStripeRefund,
  isStripeRefundSucceeded,
  retrieveStripeRefund,
} from '../src/payments/stripe-refund';

test('isStripeRefundSucceeded only accepts terminal success', () => {
  assert.equal(isStripeRefundSucceeded('succeeded'), true);
  assert.equal(isStripeRefundSucceeded('paid'), true);
  assert.equal(isStripeRefundSucceeded('pending'), false);
  assert.equal(isStripeRefundSucceeded('failed'), false);
  assert.equal(isStripeRefundSucceeded('canceled'), false);
});

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

test('createStripeRefund surfaces pending status (no assumed success)', async () => {
  const prev = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  try {
    const fetchImpl = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          id: 're_pend',
          status: 'pending',
          amount: 100,
          currency: 'usd',
        }),
      }) as any) as typeof fetch;
    const result = await createStripeRefund({
      paymentIntentOrChargeId: 'pi_x',
      amountMinor: 100,
      idempotencyKey: 'k1',
      fetchImpl,
    });
    assert.equal(result.status, 'pending');
    assert.equal(isStripeRefundSucceeded(result.status), false);
  } finally {
    if (prev === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = prev;
  }
});

test('retrieveStripeRefund GETs refund and returns status', async () => {
  const prev = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  try {
    const fetchImpl = (async (url: any, init: any) => {
      assert.equal(init.method, 'GET');
      assert.match(String(url), /\/v1\/refunds\/re_abc$/);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 're_abc',
          status: 'failed',
          amount: 50,
          currency: 'usd',
        }),
      } as any;
    }) as typeof fetch;
    const result = await retrieveStripeRefund({ refundId: 're_abc', fetchImpl });
    assert.equal(result.status, 'failed');
    assert.equal(result.alreadyRefunded, false);
  } finally {
    if (prev === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = prev;
  }
});

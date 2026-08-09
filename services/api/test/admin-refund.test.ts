import test from 'node:test';
import assert from 'node:assert/strict';
import { AdminRefundService } from '../src/admin/refund.service';
import { BizException } from '../src/common/biz.exception';

function makeService(order: Record<string, any>, opts?: { walletCalls?: string[] }) {
  const walletCalls = opts?.walletCalls ?? [];
  const updates: any[] = [];
  const prisma: any = {
    order: {
      findUnique: async () => order,
      update: async ({ data }: any) => {
        updates.push(data);
        Object.assign(order, data);
        if (data.meta) order.meta = data.meta;
        return order;
      },
    },
  };
  const audit = { write: async () => undefined };
  const wallet: any = {
    refundTopupByAdmin: async (orderNo: string) => {
      walletCalls.push(`topup:${orderNo}`);
      return { refunded: true, alreadyRefunded: false, orderNo };
    },
    revokeOnProviderRefund: async (orderNo: string) => {
      walletCalls.push(`vip:${orderNo}`);
      return { refunded: true, alreadyRefunded: false, orderNo };
    },
    refundOrder: async (orderNo: string) => {
      walletCalls.push(`unlock:${orderNo}`);
      return { refunded: true, alreadyRefunded: false, orderNo };
    },
  };
  return {
    service: new AdminRefundService(prisma, audit as any, wallet),
    walletCalls,
    updates,
  };
}

test('approve does not revoke locally when Stripe refund is pending', async () => {
  const prev = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  const order = {
    id: 1n,
    orderNo: 'TOP-1',
    userId: 9n,
    paymentMethod: 'STRIPE',
    paymentStatus: 'PAID',
    refundStatus: 'REQUESTED',
    orderType: 'TOPUP',
    externalRef: 'pi_abc',
    amountVnd: 299n,
    amountCredits: 100n,
    payCurrency: 'USD',
    meta: {},
  };
  try {
    const { service, walletCalls } = makeService(order);
    const fetchImpl = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          id: 're_pending',
          status: 'pending',
          amount: 299,
          currency: 'usd',
        }),
      }) as any) as typeof fetch;

    const result = await service.approve('TOP-1', 1n, { fetchImpl });
    assert.equal((result as any).pendingProvider, true);
    assert.equal((result as any).stripeRefundStatus, 'pending');
    assert.equal(walletCalls.length, 0);
    assert.notEqual(order.refundStatus, 'APPROVED');
  } finally {
    if (prev === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = prev;
  }
});

test('historical failed stripeRefundId is cleared and a new refund can be created', async () => {
  const prev = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  const order = {
    id: 2n,
    orderNo: 'VIP-1',
    userId: 9n,
    paymentMethod: 'STRIPE',
    paymentStatus: 'PAID',
    refundStatus: 'REQUESTED',
    orderType: 'VIP_SUB',
    externalRef: 'pi_vip',
    amountVnd: 999n,
    amountCredits: 0n,
    payCurrency: 'USD',
    meta: { stripeRefundId: 're_hist', stripeRefundStatus: 'succeeded' },
  };
  try {
    const { service, walletCalls } = makeService(order);
    let step = 0;
    const fetchImpl = (async (url: any, init?: any) => {
      step += 1;
      if (step === 1) {
        assert.match(String(url), /\/v1\/refunds\/re_hist/);
        assert.equal(init?.method || 'GET', 'GET');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 're_hist',
            status: 'failed',
            amount: 999,
            currency: 'usd',
          }),
        } as any;
      }
      assert.match(String(url), /\/v1\/refunds$/);
      assert.equal(init?.method, 'POST');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 're_retry',
          status: 'succeeded',
          amount: 999,
          currency: 'usd',
        }),
      } as any;
    }) as typeof fetch;

    const result = await service.approve('VIP-1', 1n, { fetchImpl });
    assert.equal(result.refunded, true);
    assert.deepEqual(walletCalls, ['vip:VIP-1']);
    assert.equal((order.meta as any).stripeRefundId, 're_retry');
    assert.equal((order.meta as any).stripeRefundStaleCleared, 're_hist');
  } finally {
    if (prev === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = prev;
  }
});

test('historical succeeded partial refund never full-revokes entitlements', async () => {
  const prev = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  const order = {
    id: 5n,
    orderNo: 'TOP-HIST-P',
    userId: 9n,
    paymentMethod: 'STRIPE',
    paymentStatus: 'PAID',
    refundStatus: 'REQUESTED',
    orderType: 'TOPUP',
    externalRef: 'pi_hist_partial',
    amountVnd: 1000n,
    amountCredits: 100n,
    payCurrency: 'USD',
    meta: { stripeRefundId: 're_partial_hist' },
  };
  try {
    const { service, walletCalls } = makeService(order);
    const fetchImpl = (async (url: any) => {
      assert.match(String(url), /\/v1\/refunds\/re_partial_hist/);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 're_partial_hist',
          status: 'succeeded',
          amount: 100,
          currency: 'usd',
        }),
      } as any;
    }) as typeof fetch;

    await assert.rejects(
      () => service.approve('TOP-HIST-P', 1n, { fetchImpl }),
      (e: any) => e instanceof BizException && e.message === 'stripe.partialRefundUnsupported',
    );
    assert.equal(walletCalls.length, 0);
    assert.equal((order.meta as any).partialRefundPending, true);
  } finally {
    if (prev === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = prev;
  }
});

test('approve revokes locally only after Stripe succeeded', async () => {
  const prev = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  const order = {
    id: 3n,
    orderNo: 'TOP-2',
    userId: 9n,
    paymentMethod: 'STRIPE',
    paymentStatus: 'PAID',
    refundStatus: 'REQUESTED',
    orderType: 'TOPUP',
    externalRef: 'pi_ok',
    amountVnd: 500n,
    amountCredits: 50n,
    payCurrency: 'USD',
    meta: {},
  };
  try {
    const { service, walletCalls } = makeService(order);
    const fetchImpl = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          id: 're_ok',
          status: 'succeeded',
          amount: 500,
          currency: 'usd',
        }),
      }) as any) as typeof fetch;

    const result = await service.approve('TOP-2', 1n, { fetchImpl });
    assert.equal(result.refunded, true);
    assert.deepEqual(walletCalls, ['topup:TOP-2']);
    assert.equal(order.refundStatus, 'APPROVED');
  } finally {
    if (prev === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = prev;
  }
});

test('partial Stripe refund amount is rejected (no local revoke)', async () => {
  const prev = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  const order = {
    id: 4n,
    orderNo: 'TOP-P',
    userId: 9n,
    paymentMethod: 'STRIPE',
    paymentStatus: 'PAID',
    refundStatus: 'REQUESTED',
    orderType: 'TOPUP',
    externalRef: 'pi_partial',
    amountVnd: 1000n,
    amountCredits: 100n,
    payCurrency: 'USD',
    meta: {},
  };
  try {
    const { service, walletCalls } = makeService(order);
    const fetchImpl = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          id: 're_part',
          status: 'succeeded',
          amount: 100,
          currency: 'usd',
        }),
      }) as any) as typeof fetch;

    await assert.rejects(
      () => service.approve('TOP-P', 1n, { fetchImpl }),
      (e: any) => e instanceof BizException && e.message === 'stripe.partialRefundUnsupported',
    );
    assert.equal(walletCalls.length, 0);
  } finally {
    if (prev === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = prev;
  }
});

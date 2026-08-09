import test from 'node:test';
import assert from 'node:assert/strict';
import { ReconcileService } from '../src/reconcile/reconcile.service';

function fixture(
  options: { failBalanceMove?: boolean; pendingTooLow?: boolean; settleDays?: number } = {},
) {
  let claimCalls = 0;
  let unclaimCalls = 0;
  let moveCalls = 0;
  const order = {
    id: 1n,
    orderNo: 'EP-1',
    creatorId: 2n,
    paidAt: new Date(Date.now() - 8 * 86400000),
    creatorIncomeVnd: 25n,
    payCurrency: 'USD',
    meta: { ledgerMinorUnit: 'USD_CENTS', ledgerDirty: false },
  };
  const prisma: any = {
    order: {
      count: async () => 1,
      findMany: async () => [order],
      updateMany: async () => {
        claimCalls++;
        return { count: 1 };
      },
      update: async () => {
        unclaimCalls++;
        return order;
      },
    },
    creatorEarning: {
      updateMany: async () => {
        moveCalls++;
        if (options.failBalanceMove) throw new Error('simulated balance failure');
        if (options.pendingTooLow) return { count: 0 };
        return { count: 1 };
      },
    },
    $transaction: async (fn: (tx: any) => unknown) => fn(prisma),
  };
  const platformSettings = {
    getCreatorSettleDays: async () => options.settleDays ?? 7,
  };
  return {
    service: new ReconcileService(prisma, platformSettings as any),
    claimCalls: () => claimCalls,
    unclaimCalls: () => unclaimCalls,
    moveCalls: () => moveCalls,
  };
}

test('counts a settlement only after the transaction succeeds', async () => {
  const prev = process.env.FINANCE_OPS_FROZEN;
  process.env.FINANCE_OPS_FROZEN = '0';
  try {
    const { service, claimCalls } = fixture();
    assert.deepEqual(await service.settleNow(7), {
      eligible: 1,
      settled: 1,
      days: 7,
      financeOpsFrozen: false,
    });
    assert.equal(claimCalls(), 1);
  } finally {
    if (prev === undefined) delete process.env.FINANCE_OPS_FROZEN;
    else process.env.FINANCE_OPS_FROZEN = prev;
  }
});

test('does not issue an out-of-transaction claim rollback after failure', async () => {
  const prev = process.env.FINANCE_OPS_FROZEN;
  process.env.FINANCE_OPS_FROZEN = '0';
  try {
    const { service, claimCalls } = fixture({ failBalanceMove: true });
    assert.deepEqual(await service.settleNow(7), {
      eligible: 1,
      settled: 0,
      days: 7,
      financeOpsFrozen: false,
    });
    assert.equal(claimCalls(), 1);
  } finally {
    if (prev === undefined) delete process.env.FINANCE_OPS_FROZEN;
    else process.env.FINANCE_OPS_FROZEN = prev;
  }
});

test('settleNow no-ops while finance ops frozen (USD reconciliation)', async () => {
  const prev = process.env.FINANCE_OPS_FROZEN;
  process.env.FINANCE_OPS_FROZEN = '1';
  try {
    const { service, claimCalls } = fixture();
    assert.deepEqual(await service.settleNow(7), {
      eligible: 0,
      settled: 0,
      days: 7,
      financeOpsFrozen: true,
    });
    assert.equal(claimCalls(), 0);
  } finally {
    if (prev === undefined) delete process.env.FINANCE_OPS_FROZEN;
    else process.env.FINANCE_OPS_FROZEN = prev;
  }
});

test('settleNow uses configured creatorSettleDays when days omitted', async () => {
  const prev = process.env.FINANCE_OPS_FROZEN;
  process.env.FINANCE_OPS_FROZEN = '0';
  try {
    const { service } = fixture({ settleDays: 3 });
    assert.deepEqual(await service.settleNow(), {
      eligible: 1,
      settled: 1,
      days: 3,
      financeOpsFrozen: false,
    });
  } finally {
    if (prev === undefined) delete process.env.FINANCE_OPS_FROZEN;
    else process.env.FINANCE_OPS_FROZEN = prev;
  }
});

test('settle skips and unclaims when pendingVnd never accrued', async () => {
  const prev = process.env.FINANCE_OPS_FROZEN;
  process.env.FINANCE_OPS_FROZEN = '0';
  try {
    const { service, claimCalls, unclaimCalls, moveCalls } = fixture({
      pendingTooLow: true,
    });
    assert.deepEqual(await service.settleNow(7), {
      eligible: 1,
      settled: 0,
      days: 7,
      financeOpsFrozen: false,
    });
    assert.equal(claimCalls(), 1);
    assert.equal(moveCalls(), 1);
    assert.equal(unclaimCalls(), 1);
  } finally {
    if (prev === undefined) delete process.env.FINANCE_OPS_FROZEN;
    else process.env.FINANCE_OPS_FROZEN = prev;
  }
});

test('settle skips ledgerDirty orders before claim', async () => {
  const prev = process.env.FINANCE_OPS_FROZEN;
  process.env.FINANCE_OPS_FROZEN = '0';
  try {
    const dirty = {
      id: 9n,
      orderNo: 'EP-DIRTY',
      creatorId: 2n,
      paidAt: new Date(Date.now() - 8 * 86400000),
      creatorIncomeVnd: 25n,
      payCurrency: 'USD',
      meta: { ledgerDirty: true, ledgerMinorUnit: 'USD_CENTS' },
    };
    const prisma: any = {
      order: {
        count: async () => 0,
        findMany: async () => [dirty],
        updateMany: async () => {
          throw new Error('must not claim dirty');
        },
        update: async () => dirty,
      },
      creatorEarning: {
        updateMany: async () => {
          throw new Error('must not move dirty');
        },
      },
      $transaction: async (fn: (tx: any) => unknown) => fn(prisma),
    };
    const service = new ReconcileService(prisma, {
      getCreatorSettleDays: async () => 7,
    } as any);
    assert.deepEqual(await service.settleNow(7), {
      eligible: 0,
      settled: 0,
      days: 7,
      financeOpsFrozen: false,
    });
  } finally {
    if (prev === undefined) delete process.env.FINANCE_OPS_FROZEN;
    else process.env.FINANCE_OPS_FROZEN = prev;
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { ReconcileService } from '../src/reconcile/reconcile.service';

function fixture(options: { failBalanceMove?: boolean } = {}) {
  let claimCalls = 0;
  const order = {
    id: 1n,
    orderNo: 'EP-1',
    creatorId: 2n,
    paidAt: new Date(Date.now() - 8 * 86400000),
    creatorIncomeVnd: 25n,
  };
  const prisma: any = {
    order: {
      count: async () => 1,
      findMany: async () => [order],
      updateMany: async () => {
        claimCalls++;
        return { count: 1 };
      },
    },
    creatorEarning: {
      update: async () => {
        if (options.failBalanceMove) throw new Error('simulated balance failure');
      },
    },
    $transaction: async (fn: (tx: any) => unknown) => fn(prisma),
  };
  return { service: new ReconcileService(prisma), claimCalls: () => claimCalls };
}

test('counts a settlement only after the transaction succeeds', async () => {
  const { service, claimCalls } = fixture();
  assert.deepEqual(await service.settleNow(7), { eligible: 1, settled: 1, days: 7 });
  assert.equal(claimCalls(), 1);
});

test('does not issue an out-of-transaction claim rollback after failure', async () => {
  const { service, claimCalls } = fixture({ failBalanceMove: true });
  assert.deepEqual(await service.settleNow(7), { eligible: 1, settled: 0, days: 7 });
  assert.equal(claimCalls(), 1);
});

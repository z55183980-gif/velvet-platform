import test from 'node:test';
import assert from 'node:assert/strict';
import { WalletService } from '../src/wallet/wallet.service';

function refundFixture(reversalCount: number) {
  let unlockDeletes = 0;
  const order = {
    id: 1n,
    orderNo: 'EP-REFUND-1',
    userId: 10n,
    orderType: 'EPISODE_UNLOCK',
    paymentStatus: 'PAID',
    paidAt: new Date(),
    amountCredits: 20n,
    creatorId: 30n,
    creatorIncomeVnd: 15n,
    earningSettled: false,
    episodeId: 40n,
    dramaId: 50n,
  };
  let orderRead = 0;
  const prisma: any = {
    order: {
      findUnique: async () => (++orderRead === 1 ? order : { earningSettled: false }),
      updateMany: async () => ({ count: 1 }),
    },
    wallet: {
      findUnique: async () => ({ userId: order.userId, balanceCredits: 100n, version: 0 }),
      updateMany: async () => ({ count: 1 }),
    },
    walletTransaction: { create: async () => undefined },
    creatorEarning: { updateMany: async () => ({ count: reversalCount }) },
    userUnlock: {
      deleteMany: async () => {
        unlockDeletes++;
        return { count: 1 };
      },
    },
    episode: { update: async () => undefined },
    drama: { update: async () => undefined },
    $transaction: async (fn: (tx: any) => unknown) => fn(prisma),
  };
  const log = { log: () => undefined, warn: () => undefined, error: () => undefined };
  const service = new WalletService(prisma, null as any, null as any, log as any, null as any, null as any);
  return { service, unlockDeletes: () => unlockDeletes };
}

test('refund aborts before deleting access when creator earnings cannot be reversed', async () => {
  const { service, unlockDeletes } = refundFixture(0);
  await assert.rejects(() => service.refundOrder('EP-REFUND-1', 10n, 'admin-approve'));
  assert.equal(unlockDeletes(), 0);
});

test('refund removes access after creator earnings are reversed', async () => {
  const { service, unlockDeletes } = refundFixture(1);
  const result = await service.refundOrder('EP-REFUND-1', 10n, 'admin-approve');
  assert.equal(result.refunded, true);
  assert.equal(unlockDeletes(), 1);
});

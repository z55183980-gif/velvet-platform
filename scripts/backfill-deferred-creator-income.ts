/**
 * Ops backfill: meta.deferredCreatorIncomeUsdCents → creator_earnings.pendingVnd
 *
 * Correctness:
 * - Credits order.creatorId (sale-time payee), never current drama.creatorId
 * - Reduces platformFeeVnd so amount ≈ creator + platform
 * - CAS inside txn (creatorIncomeVnd=0 + not yet backfilled) — no double credit
 *
 * Run AFTER FINANCE_OPS_FROZEN=0 and USD_CENTS_PER_CREDIT are set, and after
 * historical amountVnd reconciliation (docs/12-财务单位与对账.md).
 *
 * Usage (from repo root, with DATABASE_URL):
 *   pnpm --filter velvet-api exec ts-node --compiler-options "{\"module\":\"CommonJS\"}" ../../scripts/backfill-deferred-creator-income.ts
 *   DRY_RUN=1 …   # default: dry-run (no writes)
 *   DRY_RUN=0 …   # apply
 *   LIMIT=100 …   # optional batch cap
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const dryRun = (process.env.DRY_RUN ?? '1') !== '0';
const limit = Math.max(0, Number(process.env.LIMIT || 0) || 0);

type Meta = {
  deferredCreatorIncomeUsdCents?: string | number | null;
  creatorAccrualSkipped?: boolean;
  deferredCreatorIncomeBackfilledAt?: string;
  ledgerDirty?: boolean;
  ledgerMinorUnit?: string;
};

function parseDeferred(meta: unknown): bigint | null {
  if (!meta || typeof meta !== 'object') return null;
  const m = meta as Meta;
  if (m.deferredCreatorIncomeBackfilledAt) return null;
  if (m.ledgerDirty === true) return null;
  const raw = m.deferredCreatorIncomeUsdCents;
  if (raw == null || raw === '') return null;
  try {
    const n = BigInt(String(raw));
    return n > 0n ? n : null;
  } catch {
    return null;
  }
}

function nextPlatformFee(
  order: { amountVnd: bigint; platformFeeVnd: bigint },
  deferred: bigint,
): bigint {
  // Frozen unlocks wrote platformFee = full amount; restore amount = creator + platform.
  if (order.platformFeeVnd >= deferred) return order.platformFeeVnd - deferred;
  if (order.amountVnd >= deferred) return order.amountVnd - deferred;
  return 0n;
}

async function main() {
  if ((process.env.FINANCE_OPS_FROZEN ?? '1').trim() !== '0' && !dryRun) {
    console.error(
      'REFUSE: set FINANCE_OPS_FROZEN=0 before applying backfill (or use DRY_RUN=1).',
    );
    process.exit(2);
  }

  // Broad fetch + JS filter — JSON path operators differ across Prisma/PG setups.
  const orders = await prisma.order.findMany({
    where: {
      orderType: { in: ['EPISODE_UNLOCK', 'DRAMA_BUYOUT'] },
      paymentStatus: 'PAID',
      creatorIncomeVnd: 0n,
      creatorId: { not: null },
    },
    select: {
      id: true,
      orderNo: true,
      dramaId: true,
      creatorId: true,
      amountVnd: true,
      creatorIncomeVnd: true,
      platformFeeVnd: true,
      payCurrency: true,
      meta: true,
    },
    orderBy: { id: 'asc' },
    ...(limit > 0 ? { take: limit } : {}),
  });

  let scanned = 0;
  let eligible = 0;
  let applied = 0;
  let skipped = 0;

  for (const order of orders) {
    scanned += 1;
    const deferred = parseDeferred(order.meta);
    if (deferred == null) {
      skipped += 1;
      continue;
    }
    if (!order.creatorId) {
      skipped += 1;
      continue;
    }
    // Skip non-USD history; those need manual reconcile first.
    const payCur = String(order.payCurrency || '').toUpperCase();
    if (payCur && payCur !== 'USD') {
      skipped += 1;
      continue;
    }
    eligible += 1;
    console.log(
      `${dryRun ? 'DRY' : 'APPLY'} ${order.orderNo} +${deferred} usd-cents → creator ${order.creatorId} (platformFee ${order.platformFeeVnd}→${nextPlatformFee(order, deferred)})`,
    );
    if (dryRun) continue;

    const did = await prisma.$transaction(async (tx) => {
      const fresh = await tx.order.findUnique({
        where: { id: order.id },
        select: {
          id: true,
          creatorId: true,
          amountVnd: true,
          creatorIncomeVnd: true,
          platformFeeVnd: true,
          paymentStatus: true,
          meta: true,
        },
      });
      if (!fresh || fresh.paymentStatus !== 'PAID' || !fresh.creatorId) return false;
      if (fresh.creatorIncomeVnd !== 0n) return false;
      const amount = parseDeferred(fresh.meta);
      if (amount == null) return false;

      const prev =
        fresh.meta && typeof fresh.meta === 'object' ? (fresh.meta as Meta) : {};
      // CAS: only the txn that still sees creatorIncomeVnd=0 wins.
      const claimed = await tx.order.updateMany({
        where: {
          id: fresh.id,
          creatorIncomeVnd: 0n,
          paymentStatus: 'PAID',
        },
        data: {
          creatorIncomeVnd: amount,
          platformFeeVnd: nextPlatformFee(fresh, amount),
          meta: {
            ...prev,
            creatorAccrualSkipped: false,
            deferredCreatorIncomeBackfilledAt: new Date().toISOString(),
            deferredCreatorIncomeUsdCents: amount.toString(),
          } as any,
        },
      });
      if (claimed.count !== 1) return false;

      const earning = await tx.creatorEarning.findUnique({
        where: { creatorId: fresh.creatorId },
      });
      if (earning) {
        await tx.creatorEarning.update({
          where: { creatorId: fresh.creatorId },
          data: {
            pendingVnd: { increment: amount },
            totalEarnedVnd: { increment: amount },
          },
        });
      } else {
        await tx.creatorEarning.create({
          data: {
            creatorId: fresh.creatorId,
            pendingVnd: amount,
            totalEarnedVnd: amount,
            availableVnd: 0n,
            withdrawnVnd: 0n,
          },
        });
      }
      return true;
    });

    if (did) applied += 1;
    else skipped += 1;
  }

  console.log(
    JSON.stringify({
      dryRun,
      scanned,
      eligible,
      applied,
      skipped,
      hint: dryRun
        ? 'Re-run with DRY_RUN=0 after FINANCE_OPS_FROZEN=0 to apply'
        : 'Done — verify creator_earnings pending + order platformFee+creatorIncome≈amount',
    }),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

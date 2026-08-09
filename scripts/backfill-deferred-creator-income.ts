/**
 * Ops backfill: meta.deferredCreatorIncomeUsdCents → creator_earnings.pendingVnd
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
};

function parseDeferred(meta: unknown): bigint | null {
  if (!meta || typeof meta !== 'object') return null;
  const m = meta as Meta;
  if (m.deferredCreatorIncomeBackfilledAt) return null;
  const raw = m.deferredCreatorIncomeUsdCents;
  if (raw == null || raw === '') return null;
  try {
    const n = BigInt(String(raw));
    return n > 0n ? n : null;
  } catch {
    return null;
  }
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
    },
    select: {
      id: true,
      orderNo: true,
      dramaId: true,
      creatorIncomeVnd: true,
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
    if (order.creatorIncomeVnd > 0n) {
      // Already accrued on ledger columns — do not double-credit.
      skipped += 1;
      continue;
    }
    if (!order.dramaId) {
      skipped += 1;
      continue;
    }
    const drama = await prisma.drama.findUnique({
      where: { id: order.dramaId },
      select: { creatorId: true },
    });
    if (!drama?.creatorId) {
      skipped += 1;
      continue;
    }
    eligible += 1;
    console.log(
      `${dryRun ? 'DRY' : 'APPLY'} ${order.orderNo} +${deferred} usd-cents → creator ${drama.creatorId}`,
    );
    if (dryRun) continue;

    await prisma.$transaction(async (tx) => {
      const earning = await tx.creatorEarning.findUnique({
        where: { creatorId: drama.creatorId },
      });
      if (earning) {
        await tx.creatorEarning.update({
          where: { creatorId: drama.creatorId },
          data: {
            pendingVnd: { increment: deferred },
            totalEarnedVnd: { increment: deferred },
          },
        });
      } else {
        await tx.creatorEarning.create({
          data: {
            creatorId: drama.creatorId,
            pendingVnd: deferred,
            totalEarnedVnd: deferred,
            availableVnd: 0n,
            withdrawnVnd: 0n,
          },
        });
      }
      const prev =
        order.meta && typeof order.meta === 'object' ? (order.meta as Meta) : {};
      await tx.order.update({
        where: { id: order.id },
        data: {
          creatorIncomeVnd: deferred,
          meta: {
            ...prev,
            creatorAccrualSkipped: false,
            deferredCreatorIncomeBackfilledAt: new Date().toISOString(),
            deferredCreatorIncomeUsdCents: deferred.toString(),
          } as any,
        },
      });
    });
    applied += 1;
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
        : 'Done — verify creator_earnings pending totals',
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

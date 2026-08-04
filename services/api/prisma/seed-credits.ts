/* 积分套餐 + VIP 套餐 seed（USD 标价）
 * 运行：npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed-credits.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const VIP_PLANS = [
  {
    name: 'Monthly',
    durationDays: 30,
    baseCurrency: 'USD',
    basePrice: 4.99 as any,
    sortOrder: 10,
    badge: 'Popular' as string | null,
  },
  {
    name: 'Quarterly',
    durationDays: 90,
    baseCurrency: 'USD',
    basePrice: 11.99 as any,
    sortOrder: 20,
    badge: null as string | null,
  },
  {
    name: 'Yearly',
    durationDays: 365,
    baseCurrency: 'USD',
    basePrice: 29.99 as any,
    sortOrder: 30,
    badge: 'Best value' as string | null,
  },
];

async function ensureVipPlansEnglish() {
  for (const plan of VIP_PLANS) {
    const existing = await prisma.vipPlan.findFirst({
      where: { durationDays: plan.durationDays },
      orderBy: { id: 'asc' },
    });
    if (existing) {
      await prisma.vipPlan.update({
        where: { id: existing.id },
        data: {
          name: plan.name,
          nameEn: plan.name,
          badge: plan.badge,
          baseCurrency: 'USD',
        },
      });
      continue;
    }
    await prisma.vipPlan.create({
      data: {
        name: plan.name,
        nameEn: plan.name,
        durationDays: plan.durationDays,
        baseCurrency: plan.baseCurrency,
        basePrice: plan.basePrice,
        sortOrder: plan.sortOrder,
        badge: plan.badge,
        active: true,
      },
    });
  }

  // Rename leftover Chinese labels regardless of duration.
  await prisma.vipPlan.updateMany({
    where: { name: { in: ['月卡', '一个月', '30天'] } },
    data: { name: 'Monthly', nameEn: 'Monthly' },
  });
  await prisma.vipPlan.updateMany({
    where: { name: { in: ['季卡', '三个月', '90天'] } },
    data: { name: 'Quarterly', nameEn: 'Quarterly' },
  });
  await prisma.vipPlan.updateMany({
    where: { name: { in: ['年卡', '一年', '365天'] } },
    data: { name: 'Yearly', nameEn: 'Yearly' },
  });
  await prisma.vipPlan.updateMany({
    where: { badge: { in: ['热门', '推荐'] } },
    data: { badge: 'Popular' },
  });
  await prisma.vipPlan.updateMany({
    where: { badge: { in: ['超值', '最划算'] } },
    data: { badge: 'Best value' },
  });
}

async function main() {
  // 定价已改为直接 USD。汇率表仅兼容旧管理端，不再参与报价。
  await prisma.vipPlan.updateMany({ data: { baseCurrency: 'USD' } });
  await prisma.topupPackage.updateMany({ data: { baseCurrency: 'USD' } });
  console.log('[currency] vipPlan + topupPackage baseCurrency -> USD');

  // 默认套餐
  const count = await prisma.topupPackage.count();
  if (count === 0) {
    await prisma.topupPackage.createMany({
      data: [
        { name: 'Starter', credits: 10n, baseCurrency: 'USD', basePrice: 1.99 as any, sortOrder: 10 },
        { name: 'Popular', credits: 50n, baseCurrency: 'USD', basePrice: 7.99 as any, sortOrder: 20 },
        { name: 'Value', credits: 100n, baseCurrency: 'USD', basePrice: 12.99 as any, sortOrder: 30 },
      ],
    });
    console.log('[packages] seeded 3 packages');
  } else {
    console.log('[packages] skip, already have', count);
  }

  await ensureVipPlansEnglish();
  console.log('[vip] ensured English plan names/badges');

  // 统一剧集积分：免费区内免费；付费集固定 10 积分（勿再 1:1 拷贝 priceVnd）
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { normalizeEpisodeCredits } = require('./normalize-episode-credits');
  const norm = await normalizeEpisodeCredits(prisma);
  console.log('[episodes] normalized:', norm);

  const pkgs = await prisma.topupPackage.findMany({ orderBy: { sortOrder: 'asc' } });
  const vips = await prisma.vipPlan.findMany({ orderBy: { sortOrder: 'asc' } });
  console.log(
    '[done] packages:',
    pkgs.map((p) => `${p.name}:${p.credits}c/$${p.basePrice}`),
  );
  console.log(
    '[done] vip:',
    vips.map((p) => `${p.name}:${p.durationDays}d/$${p.basePrice}${p.badge ? `(${p.badge})` : ''}`),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

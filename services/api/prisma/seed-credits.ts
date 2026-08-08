/* 积分套餐 + VIP 套餐 seed（USD 标价）
 * 运行：npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed-credits.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_BENEFITS = ['Unlimited Viewing', '1080p High Quality'];

const VIP_PLANS = [
  {
    name: 'Weekly VIP',
    durationDays: 7,
    baseCurrency: 'USD',
    basePrice: 5.99 as any,
    originalPrice: 12.99 as any,
    sortOrder: 10,
    badge: '54% OFF' as string | null,
    descEn: 'One-time purchase for 7 days of VIP. No auto-renewal.',
    descZh: '一次性购买，开通 7 天 VIP。不会自动续费。',
    benefits: DEFAULT_BENEFITS,
  },
  {
    name: 'Monthly VIP',
    durationDays: 30,
    baseCurrency: 'USD',
    basePrice: 15.99 as any,
    originalPrice: null as any,
    sortOrder: 20,
    badge: null as string | null,
    descEn: 'One-time purchase for 30 days of VIP. No auto-renewal.',
    descZh: '一次性购买，开通 30 天 VIP。不会自动续费。',
    benefits: DEFAULT_BENEFITS,
  },
  {
    name: 'Yearly VIP',
    durationDays: 365,
    baseCurrency: 'USD',
    basePrice: 99.99 as any,
    originalPrice: null as any,
    sortOrder: 30,
    badge: null as string | null,
    descEn: 'One-time purchase for 365 days of VIP. No auto-renewal.',
    descZh: '一次性购买，开通 365 天 VIP。不会自动续费。',
    benefits: DEFAULT_BENEFITS,
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
          basePrice: plan.basePrice,
          originalPrice: plan.originalPrice,
          badge: plan.badge,
          descEn: plan.descEn,
          descZh: plan.descZh,
          benefits: plan.benefits,
          sortOrder: plan.sortOrder,
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
        originalPrice: plan.originalPrice,
        sortOrder: plan.sortOrder,
        badge: plan.badge,
        descEn: plan.descEn,
        descZh: plan.descZh,
        benefits: plan.benefits,
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
  // 定价直接 USD，无汇率折算。
  await prisma.vipPlan.updateMany({ data: { baseCurrency: 'USD' } });
  await prisma.topupPackage.updateMany({ data: { baseCurrency: 'USD' } });
  console.log('[currency] vipPlan + topupPackage baseCurrency -> USD');

  // 默认套餐
  const count = await prisma.topupPackage.count();
  if (count === 0) {
    await prisma.topupPackage.createMany({
      data: [
        {
          name: 'Starter',
          baseCredits: 300n,
          bonusCredits: 0n,
          credits: 300n,
          baseCurrency: 'USD',
          basePrice: 2.99 as any,
          sortOrder: 10,
          badge: null,
        },
        {
          name: 'Popular',
          baseCredits: 500n,
          bonusCredits: 75n,
          credits: 575n,
          baseCurrency: 'USD',
          basePrice: 4.99 as any,
          sortOrder: 20,
          badge: '+15%',
        },
        {
          name: 'Value',
          baseCredits: 1000n,
          bonusCredits: 200n,
          credits: 1200n,
          baseCurrency: 'USD',
          basePrice: 9.99 as any,
          sortOrder: 30,
          badge: '+20%',
        },
      ],
    });
    console.log('[packages] seeded 3 packages');
  } else {
    console.log('[packages] skip seed, already have', count);
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

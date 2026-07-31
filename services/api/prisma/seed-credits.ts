/* 积分套餐 + CNY 基准汇率 seed
 * 运行：npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed-credits.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1) 汇率：buyRate = cnyToFiat（1 CNY = N 该币）
  const seeds: { currency: string; cnyToFiat: string }[] = [
    { currency: 'CNY', cnyToFiat: '1' },
    { currency: 'VND', cnyToFiat: '3500' },
  ];
  for (const s of seeds) {
    await prisma.creditExchangeRate.upsert({
      where: { currency: s.currency },
      create: {
        currency: s.currency,
        buyRate: s.cnyToFiat as any,
        sellRate: s.cnyToFiat as any,
      },
      update: {
        buyRate: s.cnyToFiat as any,
        sellRate: s.cnyToFiat as any,
      },
    });
    console.log(`[rate] upsert ${s.currency} cnyToFiat=${s.cnyToFiat}`);
  }

  // 2) 默认套餐
  const count = await prisma.topupPackage.count();
  if (count === 0) {
    await prisma.topupPackage.createMany({
      data: [
        { name: '入门', credits: 10n, baseCurrency: 'CNY', basePrice: 10 as any, sortOrder: 10 },
        { name: '常用', credits: 50n, baseCurrency: 'CNY', basePrice: 50 as any, sortOrder: 20 },
        { name: '超值', credits: 100n, baseCurrency: 'CNY', basePrice: 90 as any, sortOrder: 30 },
      ],
    });
    console.log('[packages] seeded 3 packages');
  } else {
    console.log('[packages] skip, already have', count);
  }

  // 3) 统一剧集积分：免费区内免费；付费集固定 10 积分（勿再 1:1 拷贝 priceVnd）
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { normalizeEpisodeCredits } = require('./normalize-episode-credits');
  const norm = await normalizeEpisodeCredits(prisma);
  console.log('[episodes] normalized:', norm);

  const rates = await prisma.creditExchangeRate.findMany();
  const pkgs = await prisma.topupPackage.findMany({ orderBy: { sortOrder: 'asc' } });
  console.log('[done] rates:', rates);
  console.log(
    '[done] packages:',
    pkgs.map((p) => `${p.name}:${p.credits}c/¥${p.basePrice}`),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

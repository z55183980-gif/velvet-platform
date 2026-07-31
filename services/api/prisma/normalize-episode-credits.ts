/**
 * 统一全库剧集积分定价（便于测试）
 *
 * 规则：
 * - 集号 ≤ drama.freeEpisodeCount → 免费（isFree=true, priceCredits=0, priceVnd=0）
 * - 其余付费集 → 固定 PAID_CREDITS 积分/集（默认 10，对齐入门充值套餐）
 *
 * 运行：
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/normalize-episode-credits.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** 付费集统一积分（与最小充值套餐 10 对齐） */
export const PAID_CREDITS = 10n;
/** 付费集法币参考价（创作者分润展示用，不影响积分扣款） */
export const PAID_VND = 10000n;

export async function normalizeEpisodeCredits(client: PrismaClient = prisma) {
  const dramas = await client.drama.findMany({
    select: {
      id: true,
      slug: true,
      titleZh: true,
      freeEpisodeCount: true,
      episodes: {
        select: {
          id: true,
          episodeNumber: true,
          isFree: true,
          priceCredits: true,
          priceVnd: true,
        },
      },
    },
  });

  let freeUpdated = 0;
  let paidUpdated = 0;
  let unchanged = 0;

  for (const d of dramas) {
    for (const ep of d.episodes) {
      const shouldFree = ep.episodeNumber <= d.freeEpisodeCount;
      if (shouldFree) {
        const need =
          !ep.isFree || ep.priceCredits !== 0n || ep.priceVnd !== 0n;
        if (need) {
          await client.episode.update({
            where: { id: ep.id },
            data: { isFree: true, priceCredits: 0n, priceVnd: 0n },
          });
          freeUpdated += 1;
        } else {
          unchanged += 1;
        }
      } else {
        const need =
          ep.isFree ||
          ep.priceCredits !== PAID_CREDITS ||
          ep.priceVnd !== PAID_VND;
        if (need) {
          await client.episode.update({
            where: { id: ep.id },
            data: {
              isFree: false,
              priceCredits: PAID_CREDITS,
              priceVnd: PAID_VND,
            },
          });
          paidUpdated += 1;
        } else {
          unchanged += 1;
        }
      }
    }
  }

  return {
    dramas: dramas.length,
    episodes: dramas.reduce((n, d) => n + d.episodes.length, 0),
    freeUpdated,
    paidUpdated,
    unchanged,
    paidCredits: Number(PAID_CREDITS),
  };
}

async function main() {
  const result = await normalizeEpisodeCredits();
  console.log('[normalize-episode-credits]', result);

  // 抽查：付费集不得为 0
  const bad = await prisma.episode.findMany({
    where: { isFree: false, priceCredits: 0 },
    select: {
      episodeNumber: true,
      drama: { select: { slug: true, freeEpisodeCount: true } },
    },
    take: 20,
  });
  if (bad.length) {
    console.error('[normalize-episode-credits] FAIL paid-with-0:', bad);
    process.exit(1);
  }

  const sample = await prisma.episode.findMany({
    where: { drama: { slug: 'xing-ji-zhui-xu' } },
    orderBy: { episodeNumber: 'asc' },
    select: {
      episodeNumber: true,
      isFree: true,
      priceCredits: true,
      priceVnd: true,
    },
  });
  console.log(
    '[sample xing-ji-zhui-xu]',
    sample.map((e) => ({
      n: e.episodeNumber,
      free: e.isFree,
      credits: e.priceCredits.toString(),
      vnd: e.priceVnd.toString(),
    })),
  );
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

const SAMPLE_ROOT =
  process.env.SAMPLE_ROOT || '/Users/ahs/Downloads/aidym宣传视频/历史成品';

const VIDEO_EXT = new Set([
  '.mp4',
  '.mov',
  '.webm',
  '.mkv',
  '.m4v',
  '.avi',
  '.3gp',
  '.3g2',
  '.wmv',
  '.flv',
  '.f4v',
  '.ts',
  '.m2ts',
  '.mts',
  '.mpg',
  '.mpeg',
  '.ogv',
  '.asf',
]);
const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

function norm(s: string) {
  return s.replace(
    /[\s;:；：，,、.。！!?？'""''()（）\[\]【】`~@#$%^&*\-_=+]/g,
    '',
  );
}

interface Def {
  slug: string;
  titleEn: string;
  titleZh: string;
  descEn: string;
  descZh: string;
  category: string;
  freeCount: number;
  priceCredits: bigint;
  priceVnd: bigint;
  isOfficial?: boolean;
  isFeatured?: boolean;
}

const PAID_CREDITS = 10n;
const PAID_VND = 10000n;

// 按“归一化名”匹配文件夹；value 为元数据
const DEFS: Record<string, Def> = {
  末世之约: {
    slug: 'mo-shi-zhi-yue',
    titleEn: 'Apocalypse Pact',
    titleZh: '末世之约',
    descEn: 'The world collapses; survivors search for one last hope among the ruins.',
    descZh: '末世降临，幸存者在废墟中追寻最后的希望。',
    category: 'psychological',
    freeCount: 2,
    priceCredits: PAID_CREDITS,
    priceVnd: PAID_VND,
    isOfficial: true,
    isFeatured: true,
  },
  穿越修仙界我靠手机忽悠全宗门: {
    slug: 'chuan-yue-xiu-xian',
    titleEn: 'Phone Cultivator',
    titleZh: '穿越修仙界，我靠手机忽悠全宗门',
    descEn: 'A modern man travels into a cultivation world with nothing but his phone.',
    descZh: '现代青年带着手机穿越修仙界，凭科技忽悠整个宗门。',
    category: 'costume',
    freeCount: 2,
    priceCredits: PAID_CREDITS,
    priceVnd: PAID_VND,
    isFeatured: true,
  },
  青灯引僵成片: {
    slug: 'qing-deng-yin-jiang',
    titleEn: 'Blue Lantern Summons the Undead',
    titleZh: '青灯引僵',
    descEn: 'A blue lantern guides the sleeping undead back to the living world.',
    descZh: '一盏青灯，引动沉睡的僵尸归来。',
    category: 'costume',
    freeCount: 1,
    priceCredits: PAID_CREDITS,
    priceVnd: PAID_VND,
  },
  魔兽争霸霜狼之子荣耀觉醒: {
    slug: 'mo-shou-shuang-lang',
    titleEn: "Warcraft: Frostwolf's Child",
    titleZh: '魔兽争霸：霜狼之子',
    descEn: 'The frost-wolf legend rises again across the battlefields.',
    descZh: '霜狼之子在战场中觉醒，书写魔兽传奇。',
    category: 'action',
    freeCount: 1,
    priceCredits: PAID_CREDITS,
    priceVnd: PAID_VND,
  },
  星际赘婿地球男儿太抢手: {
    slug: 'xing-ji-zhui-xu',
    titleEn: 'Interstellar Son-in-Law',
    titleZh: '星际赘婿：地球男儿太抢手',
    descEn: 'An earthborn son-in-law shakes the entire galaxy.',
    descZh: '来自地球的赘婿，意外成为星际焦点。',
    category: 'action',
    freeCount: 1,
    priceCredits: PAID_CREDITS,
    priceVnd: PAID_VND,
  },
  江西赶尸人: {
    slug: 'jiang-xi-gan-shi',
    titleEn: 'Jiangxi Corpse Herder',
    titleZh: '江西赶尸人',
    descEn: 'A corpse herder from Jiangxi walks through dark mountain villages at night.',
    descZh: '江西赶尸人，夜行于幽暗山村之间。',
    category: 'costume',
    freeCount: 2,
    priceCredits: PAID_CREDITS,
    priceVnd: PAID_VND,
  },
};

const CATEGORIES = [
  { slug: 'urban', nameEn: 'Urban', nameZh: '都市', nameFr: 'Urbain' },
  { slug: 'romance', nameEn: 'Romance', nameZh: '言情', nameFr: 'Romance' },
  { slug: 'action', nameEn: 'Action', nameZh: '动作', nameFr: 'Action' },
  { slug: 'comedy', nameEn: 'Comedy', nameZh: '喜剧', nameFr: 'Comédie' },
  { slug: 'psychological', nameEn: 'Psychological', nameZh: '心理', nameFr: 'Psychologique' },
  { slug: 'costume', nameEn: 'Costume', nameZh: '古装', nameFr: 'Costume' },
];

function numCmp(a: string, b: string) {
  const na = parseInt((a.match(/\d+/g) || ['0']).join(''), 10) || 0;
  const nb = parseInt((b.match(/\d+/g) || ['0']).join(''), 10) || 0;
  return na - nb;
}

async function main() {
  if (!fs.existsSync(SAMPLE_ROOT)) {
    console.error('[import-samples] SAMPLE_ROOT 不存在:', SAMPLE_ROOT);
    process.exit(1);
  }

  // 保证分类存在
  for (const c of CATEGORIES) {
    await prisma.category.upsert({ where: { slug: c.slug }, create: c, update: c });
  }

  // 取/建默认创作者
  let creator = await prisma.creator.findFirst();
  if (!creator) {
    const u = await prisma.user.upsert({
      where: { email: 'sample@velvet.dev' },
      create: { email: 'sample@velvet.dev', nickname: 'Sample Studio' },
      update: {},
    });
    creator = await prisma.creator.create({
      data: {
        userId: u.id,
        creatorType: 'INDIVIDUAL',
        displayName: 'Sample Studio',
        revenueShare: 0.7,
        kycStatus: 'APPROVED',
      },
    });
  }

  const dirs = fs
    .readdirSync(SAMPLE_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const dir of dirs) {
    const def = DEFS[norm(dir)];
    if (!def) {
      console.log('[import-samples] 跳过未配置文件夹:', dir);
      continue;
    }
    const existing = await prisma.drama.findUnique({ where: { slug: def.slug } });
    if (existing) {
      console.log('[import-samples] 已存在，跳过:', def.slug);
      continue;
    }

    const folder = path.join(SAMPLE_ROOT, dir);
    const files = fs.readdirSync(folder);

    // 视频（排除 素材 子目录）
    const videos = files
      .filter((f) => VIDEO_EXT.has(path.extname(f).toLowerCase()))
      .sort((a, b) => numCmp(a, b));

    if (videos.length === 0) {
      console.log('[import-samples] 无视频，跳过:', dir);
      continue;
    }

    // 封面（顶层图片，优先 封面/cover）
    const topImgs = files.filter((f) => IMG_EXT.has(path.extname(f).toLowerCase()));
    const coverFile = topImgs.find((f) => /cover|封面/i.test(f)) || topImgs[0];
    const coverUrl = coverFile
      ? `/api/v1/media/${encodeURIComponent(dir)}/${encodeURIComponent(coverFile)}`
      : '';

    const drama = await prisma.drama.create({
      data: {
        creatorId: creator.id,
        slug: def.slug,
        titleEn: def.titleEn,
        titleZh: def.titleZh,
        descriptionEn: def.descEn,
        descriptionZh: def.descZh,
        categorySlug: def.category,
        coverUrl,
        freeEpisodeCount: def.freeCount,
        isOfficial: !!def.isOfficial,
        isFeatured: !!def.isFeatured,
        status: 'LIVE',
        publishedAt: new Date(),
        totalEpisodes: videos.length,
        viewCount: BigInt(Math.floor(Math.random() * 5000) + 500),
        unlockCount: BigInt(Math.floor(Math.random() * 500) + 50),
      },
    });

    for (let i = 0; i < videos.length; i++) {
      const f = videos[i];
      const ep = i + 1;
      const isFree = ep <= def.freeCount;
      const rel = `${dir}/${f}`; // 相对路径，play 接口会拼 /api/v1/media/
      await prisma.episode.create({
        data: {
          dramaId: drama.id,
          episodeNumber: ep,
          title: `Episode ${ep}`,
          isFree,
          priceVnd: isFree ? 0n : def.priceVnd,
          priceCredits: isFree ? 0n : def.priceCredits,
          durationSec: 120,
          hlsUrl: rel,
          thumbnailUrl: coverUrl,
          uploadStatus: 'COMPLETED',
          transcodeStatus: 'COMPLETED',
        },
      });
    }
    console.log(
      `[import-samples] ${def.titleZh} → ${videos.length} episodes (free ${def.freeCount}), cover=${coverFile || '无'}`,
    );
  }
  console.log('[import-samples] done');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

const categories = [
  { slug: 'do_thi', nameEn: 'Urban', nameZh: '都市', nameFr: 'Urbain', sortOrder: 1 },
  { slug: 'ngon_tinh', nameEn: 'Romance', nameZh: '言情', nameFr: 'Romance', sortOrder: 2 },
  { slug: 'hanh_dong', nameEn: 'Action', nameZh: '动作', nameFr: 'Action', sortOrder: 3 },
  { slug: 'hai_huoc', nameEn: 'Comedy', nameZh: '喜剧', nameFr: 'Comédie', sortOrder: 4 },
  { slug: 'tam_ly', nameEn: 'Psychological', nameZh: '心理', nameFr: 'Psychologique', sortOrder: 5 },
  { slug: 'co_trang', nameEn: 'Costume', nameZh: '古装', nameFr: 'Costume', sortOrder: 6 },
];

interface SeedDrama {
  titleEn: string;
  titleZh: string;
  descEn: string;
  descZh: string;
  category: string;
  episodes: number;
  cover: string;
  official?: boolean;
  featured?: boolean;
}

const dramas: SeedDrama[] = [
  { titleEn: 'The Cold CEO', titleZh: '冷面总裁', descEn: 'An ordinary secretary and a cold-faced CEO.', descZh: '平凡秘书与冷面总裁的爱情故事。', category: 'ngon_tinh', episodes: 12, cover: 'https://picsum.photos/seed/d01/600/800', official: true, featured: true },
  { titleEn: 'Love After One Night', titleZh: '一夜之后', descEn: 'After one drunken night, she carries the CEO\'s child.', descZh: '一夜醉酒后，她怀上了总裁的孩子。', category: 'ngon_tinh', episodes: 10, cover: 'https://picsum.photos/seed/d02/600/800', featured: true },
  { titleEn: 'Battle in the Dark', titleZh: '暗夜之战', descEn: 'Underground forces wage a secret war for the city.', descZh: '盘踞城市的地下势力暗战。', category: 'hanh_dong', episodes: 14, cover: 'https://picsum.photos/seed/d03/600/800' },
  { titleEn: 'Genius Doctor', titleZh: '天才医生', descEn: 'A gifted doctor with a mysterious past.', descZh: '拥有神秘过往的天才医生。', category: 'tam_ly', episodes: 11, cover: 'https://picsum.photos/seed/d04/600/800' },
  { titleEn: 'Naughty Little Wife', titleZh: '调皮小妻', descEn: 'The hilarious everyday life of a young couple.', descZh: '年轻夫妻啼笑皆非的日常。', category: 'hai_huoc', episodes: 9, cover: 'https://picsum.photos/seed/d05/600/800', featured: true },
  { titleEn: 'Secret Dynasty', titleZh: '秘境王朝', descEn: 'A journey to reclaim a lost kingdom.', descZh: '寻回失落王国的冒险旅程。', category: 'co_trang', episodes: 13, cover: 'https://picsum.photos/seed/d06/600/800', official: true },
  { titleEn: 'Billion-Dollar Deal', titleZh: '亿万交易', descEn: 'Trillion-scale deals negotiated at the table.', descZh: '谈判桌上的千亿级商战。', category: 'do_thi', episodes: 12, cover: 'https://picsum.photos/seed/d07/600/800' },
  { titleEn: 'Love Academy', titleZh: '恋爱学院', descEn: 'First flutters of love on campus.', descZh: '校园里最初的悸动。', category: 'ngon_tinh', episodes: 10, cover: 'https://picsum.photos/seed/d08/600/800' },
  { titleEn: 'Lone Assassin', titleZh: '孤影杀手', descEn: 'An assassin seeking redemption.', descZh: '寻求救赎的孤独杀手。', category: 'hanh_dong', episodes: 11, cover: 'https://picsum.photos/seed/d09/600/800' },
];

function assertSeedAllowed() {
  const env = (
    process.env.ENVIRONMENT ||
    process.env.APP_ENV ||
    process.env.NODE_ENV ||
    ''
  )
    .trim()
    .toLowerCase();
  const isProd = env === 'production' || env === 'prod' || env === 'live';
  if (!isProd) return;
  if (process.env.ALLOW_PRODUCTION_SEED !== '1') {
    throw new Error(
      'Refusing prisma seed in production. Set ALLOW_PRODUCTION_SEED=1 only for controlled bootstrap.',
    );
  }
  const pwd = process.env.ADMIN_BOOTSTRAP_PASSWORD || '';
  if (!pwd || pwd === 'admin' || pwd.length < 12) {
    throw new Error(
      'Production seed requires ADMIN_BOOTSTRAP_PASSWORD (min 12 chars, not the default "admin").',
    );
  }
}

async function main() {
  assertSeedAllowed();
  // 始终确保默认管理员存在（幂等）
  await ensureBootstrapAdmin();

  // 幂等：已有短剧则跳过剧集种子
  const existing = await prisma.drama.count();
  if (existing > 0) {
    // eslint-disable-next-line no-console
    console.log('[seed] 已存在数据，跳过短剧种子（如需重置请清空数据库）');
    return;
  }

  for (const c of categories) {
    await prisma.category.upsert({
      where: { slug: c.slug },
      create: c,
      update: c,
    });
  }

  const officialCreator = await prisma.creator.create({
    data: { userId: (await ensureSystemUser('official@velvet.dev')).id, creatorType: 'OFFICIAL', displayName: 'Velvet Studio', revenueShare: 1.0, kycStatus: 'APPROVED' },
  });
  const indieCreator = await prisma.creator.create({
    data: { userId: (await ensureSystemUser('indie@velvet.dev')).id, creatorType: 'INDIVIDUAL', displayName: 'Indie Films', revenueShare: 0.7, kycStatus: 'APPROVED' },
  });

  for (let i = 0; i < dramas.length; i++) {
    const d = dramas[i];
    const creator = d.official ? officialCreator : indieCreator;
    const drama = await prisma.drama.create({
      data: {
        creatorId: creator.id,
        slug: `d${String(i + 1).padStart(2, '0')}`,
        titleEn: d.titleEn,
        titleZh: d.titleZh,
        descriptionEn: d.descEn,
        descriptionZh: d.descZh,
        categorySlug: d.category,
        coverUrl: d.cover,
        freeEpisodeCount: 3,
        isOfficial: !!d.official,
        isFeatured: !!d.featured,
        status: 'LIVE',
        publishedAt: new Date(),
        totalEpisodes: d.episodes,
        viewCount: BigInt(1000 + i * 137),
        unlockCount: BigInt(50 + i * 13),
      },
    });
    for (let ep = 1; ep <= d.episodes; ep++) {
      const isFree = ep <= 3;
      // 测试定价：免费区内免费；付费集统一 10 积分（对齐入门充值套餐）
      await prisma.episode.create({
        data: {
          dramaId: drama.id,
          episodeNumber: ep,
          title: `Episode ${ep}`,
          isFree,
          priceVnd: isFree ? 0n : 10000n,
          priceCredits: isFree ? 0n : 10n,
          durationSec: 90 + (ep % 4) * 15,
          hlsUrl: `https://cdn.velvetmovie.space/v/${drama.uuid}/ep${ep}/index.m3u8`,
          thumbnailUrl: `https://picsum.photos/seed/${drama.uuid}_${ep}/400/225`,
          transcodeStatus: 'COMPLETED',
        },
      });
    }
    // eslint-disable-next-line no-console
    console.log(`[seed] drama ${d.titleEn} (${d.episodes} episodes)`);
  }

  // Banner
  const now = new Date();
  await prisma.banner.create({
    data: {
      titleEn: 'Unlock all episodes for 99K',
      titleZh: '99K 解锁全部剧集',
      imageUrl: 'https://picsum.photos/seed/banner1/1200/400',
      linkUrl: '/',
      startAt: now,
      endAt: new Date(now.getTime() + 30 * 86400000),
      sortOrder: 1,
    },
  });

  // 测试观众（含钱包余额，便于体验解锁）
  const viewer = await prisma.user.create({
    data: {
      phone: '+84901234567',
      nickname: 'Test Viewer',
    },
  });
  await prisma.wallet.create({
    data: { userId: viewer.id, balanceCredits: 200000n, totalRechargedCredits: 200000n },
  });
  // eslint-disable-next-line no-console
  console.log(`[seed] viewer phone=+84901234567 wallet=200000 credits`);

  const keepSettingKeys = [
    'siteName',
    'supportEmail',
    'supportUrl',
    'termsUrl',
    'privacyUrl',
    'maintenanceMode',
    'maintenanceMessage',
    'revenueShareDefault',
    'minWithdrawVnd',
    'pitRate',
    'episodeLockMode',
    'defaultFreeEpisodes',
    'defaultPreviewSeconds',
    'defaultPriceCredits',
    'defaultBuyoutDiscountPercent',
    'paymentGateways.stripe',
  ];
  await prisma.systemSetting.deleteMany({
    where: { key: { notIn: keepSettingKeys } },
  });
  const settingDefaults: Array<{ key: string; value: unknown }> = [
    { key: 'siteName', value: 'Velvet' },
    { key: 'supportEmail', value: 'support@velvetmovie.space' },
    { key: 'supportUrl', value: '' },
    { key: 'termsUrl', value: '/terms' },
    { key: 'privacyUrl', value: '/privacy' },
    { key: 'maintenanceMode', value: false },
    { key: 'maintenanceMessage', value: '' },
    { key: 'revenueShareDefault', value: 0.7 },
    { key: 'minWithdrawVnd', value: 1000 },
    { key: 'pitRate', value: 0.05 },
    { key: 'episodeLockMode', value: 'FREE_FIRST_N' },
    { key: 'defaultFreeEpisodes', value: 3 },
    { key: 'defaultPreviewSeconds', value: 0 },
    { key: 'defaultPriceCredits', value: 10 },
    { key: 'defaultBuyoutDiscountPercent', value: 70 },
  ];
  for (const item of settingDefaults) {
    await prisma.systemSetting.upsert({
      where: { key: item.key },
      create: { key: item.key, value: item.value as any },
      update: {},
    });
  }

  // eslint-disable-next-line no-console
  console.log('[seed] done');
}

async function ensureBootstrapAdmin() {
  const email = (process.env.ADMIN_BOOTSTRAP_EMAIL || 'admin@velvet.local').trim().toLowerCase();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || 'admin';
  const username = (process.env.ADMIN_BOOTSTRAP_USERNAME || 'admin').trim().toLowerCase();
  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    // eslint-disable-next-line no-console
    console.log(`[seed] admin already exists: ${email}`);
    return;
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  await prisma.adminUser.create({
    data: {
      email,
      username,
      passwordHash: `${salt}:${hash}`,
      displayName: 'Admin',
      status: 'ACTIVE',
    },
  });
  // eslint-disable-next-line no-console
  console.log(`[seed] admin created: ${email} / ${username}`);
}

async function ensureSystemUser(email: string) {
  return prisma.user.upsert({
    where: { email },
    create: { email, nickname: email.split('@')[0] },
    update: {},
  });
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

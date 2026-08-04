import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

const categories = [
  { slug: 'do_thi', nameVi: 'Đô thị', nameZh: '都市', sortOrder: 1 },
  { slug: 'ngon_tinh', nameVi: 'Ngôn tình', nameZh: '言情', sortOrder: 2 },
  { slug: 'hanh_dong', nameVi: 'Hành động', nameZh: '动作', sortOrder: 3 },
  { slug: 'hai_huoc', nameVi: 'Hài hước', nameZh: '喜剧', sortOrder: 4 },
  { slug: 'tam_ly', nameVi: 'Tâm lý', nameZh: '心理', sortOrder: 5 },
  { slug: 'co_trang', nameVi: 'Cổ trang', nameZh: '古装', sortOrder: 6 },
];

interface SeedDrama {
  titleVi: string;
  titleZh: string;
  descVi: string;
  descZh: string;
  category: string;
  episodes: number;
  cover: string;
  official?: boolean;
  featured?: boolean;
}

const dramas: SeedDrama[] = [
  { titleVi: 'Tổng tài lạnh lùng', titleZh: '冷面总裁', descVi: 'Cô thư ký bình thường và vị tổng tài lạnh lùng.', descZh: '平凡秘书与冷面总裁的爱情故事。', category: 'ngon_tinh', episodes: 12, cover: 'https://picsum.photos/seed/d01/600/800', official: true, featured: true },
  { titleVi: 'Yêu sau một đêm', titleZh: '一夜之后', descVi: 'Sau một đêm say, cô mang thai con của tổng tài.', descZh: '一夜醉酒后，她怀上了总裁的孩子。', category: 'ngon_tinh', episodes: 10, cover: 'https://picsum.photos/seed/d02/600/800', featured: true },
  { titleVi: 'Đại chiến ngầm', titleZh: '暗夜之战', descVi: 'Những thế lực ngầm thao túng thành phố.', descZh: '盘踞城市的地下势力暗战。', category: 'hanh_dong', episodes: 14, cover: 'https://picsum.photos/seed/d03/600/800' },
  { titleVi: 'Bác sĩ thiên tài', titleZh: '天才医生', descVi: 'Chàng bác sĩ tài năng với quá khứ bí ẩn.', descZh: '拥有神秘过往的天才医生。', category: 'tam_ly', episodes: 11, cover: 'https://picsum.photos/seed/d04/600/800' },
  { titleVi: 'Cô vợ nhỏ nghịch ngợm', titleZh: '调皮小妻', descVi: 'Cuộc sống dở khóc dở cười của cặp vợ chồng trẻ.', descZh: '年轻夫妻啼笑皆非的日常。', category: 'hai_huoc', episodes: 9, cover: 'https://picsum.photos/seed/d05/600/800', featured: true },
  { titleVi: 'Vương triều bí mật', titleZh: '秘境王朝', descVi: 'Hành trình tìm lại vương quốc đã mất.', descZh: '寻回失落王国的冒险旅程。', category: 'co_trang', episodes: 13, cover: 'https://picsum.photos/seed/d06/600/800', official: true },
  { titleVi: 'Giao dịch tỷ đô', titleZh: '亿万交易', descVi: 'Những thương vụ nghìn tỷ trên bàn đàm phán.', descZh: '谈判桌上的千亿级商战。', category: 'do_thi', episodes: 12, cover: 'https://picsum.photos/seed/d07/600/800' },
  { titleVi: 'Học viện tình yêu', titleZh: '恋爱学院', descVi: 'Những rung động đầu đời trong khuôn viên trường.', descZh: '校园里最初的悸动。', category: 'ngon_tinh', episodes: 10, cover: 'https://picsum.photos/seed/d08/600/800' },
  { titleVi: 'Sát thủ cô độc', titleZh: '孤影杀手', descVi: 'Một sát thủ tìm kiếm sự chuộc tội.', descZh: '寻求救赎的孤独杀手。', category: 'hanh_dong', episodes: 11, cover: 'https://picsum.photos/seed/d09/600/800' },
];

async function main() {
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
    data: { userId: (await ensureSystemUser('indie@velvet.dev')).id, creatorType: 'INDIVIDUAL', displayName: 'Độc lập Films', revenueShare: 0.7, kycStatus: 'APPROVED' },
  });

  for (let i = 0; i < dramas.length; i++) {
    const d = dramas[i];
    const creator = d.official ? officialCreator : indieCreator;
    const drama = await prisma.drama.create({
      data: {
        creatorId: creator.id,
        slug: `d${String(i + 1).padStart(2, '0')}`,
        titleVi: d.titleVi,
        titleZh: d.titleZh,
        descriptionVi: d.descVi,
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
          title: `Tập ${ep}`,
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
    console.log(`[seed] drama ${d.titleVi} (${d.episodes} tập)`);
  }

  // Banner
  const now = new Date();
  await prisma.banner.create({
    data: {
      titleVi: 'Mở khóa tất cả tập với 99K',
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
      nickname: 'Khán giả thử',
    },
  });
  await prisma.wallet.create({
    data: { userId: viewer.id, balanceCredits: 200000n, totalRechargedCredits: 200000n },
  });
  // eslint-disable-next-line no-console
  console.log(`[seed] viewer phone=+84901234567 wallet=200000 credits`);

  await prisma.systemSetting.upsert({
    where: { key: 'episodeLockMode' },
    create: { key: 'episodeLockMode', value: 'FREE_FIRST_N' },
    update: {},
  });
  await prisma.systemSetting.upsert({
    where: { key: 'defaultFreeEpisodes' },
    create: { key: 'defaultFreeEpisodes', value: 3 },
    update: {},
  });
  await prisma.systemSetting.upsert({
    where: { key: 'free_episode_count' },
    create: { key: 'free_episode_count', value: 3 },
    update: { value: 3 },
  });

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

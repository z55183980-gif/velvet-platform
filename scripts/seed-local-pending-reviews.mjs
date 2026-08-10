/**
 * Local-only fixture: pending KYC creators, PENDING withdraws, PENDING_REVIEW
 * unofficial dramas for Ops admin UI checks.
 *
 * Usage (from repo root or services/api):
 *   node scripts/seed-local-pending-reviews.mjs
 *
 * Requires DATABASE_URL (loads services/api/.env via dotenv if present).
 * Idempotent via stable emails / slugs / requestNos (SEED-*).
 * Do NOT run against production.
 */
import { createRequire } from 'node:module';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const apiDir = join(root, 'services', 'api');

// Prefer Prisma client from velvet-api package
const require = createRequire(join(apiDir, 'package.json'));

function loadEnv() {
  const candidates = [join(apiDir, '.env'), join(root, '.env')];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      require('dotenv').config({ path: p });
      return p;
    } catch {
      // dotenv optional — DATABASE_URL may already be set
    }
  }
  return null;
}

const envPath = loadEnv();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SEED_MARK = 'seed-local-pending';
const TEST_PASSWORD = 'Test1234!';

const CATEGORIES = [
  { slug: 'urban', nameEn: 'Urban', nameZh: '都市', sortOrder: 1 },
  { slug: 'romance', nameEn: 'Romance', nameZh: '言情', sortOrder: 2 },
  { slug: 'action', nameEn: 'Action', nameZh: '动作', sortOrder: 3 },
  { slug: 'comedy', nameEn: 'Comedy', nameZh: '喜剧', sortOrder: 4 },
  { slug: 'psychological', nameEn: 'Psychological', nameZh: '心理', sortOrder: 5 },
  { slug: 'costume', nameEn: 'Costume', nameZh: '古装', sortOrder: 6 },
];

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function assertLocalDb(url) {
  if (!url) throw new Error('DATABASE_URL is not set');
  const lower = url.toLowerCase();
  const blocked =
    /velvetmovie\.space|neon\.tech|supabase\.co|amazonaws\.com|railway\.app|render\.com/.test(
      lower,
    );
  const local =
    /localhost|127\.0\.0\.1|0\.0\.0\.0|:5432\/|:5433\/|:5434\//.test(lower) ||
    lower.includes('host=127') ||
    lower.includes('host=localhost');
  if (blocked || !local) {
    throw new Error(
      `Refusing to run: DATABASE_URL does not look local.\n  ${url.replace(/:([^:@]+)@/, ':***@')}`,
    );
  }
}

function genRequestNo(i) {
  return `SEED-WD-${String(i).padStart(3, '0')}`;
}

async function ensureCategories() {
  for (const c of CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: c.slug },
      create: c,
      update: { nameEn: c.nameEn, nameZh: c.nameZh, sortOrder: c.sortOrder, isActive: true },
    });
  }
}

async function ensureUser({ email, username, nickname }) {
  const passwordHash = hashPassword(TEST_PASSWORD);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        username: existing.username || username,
        nickname: existing.nickname || nickname,
        passwordHash: existing.passwordHash || passwordHash,
        status: 'ACTIVE',
      },
    });
  }
  return prisma.user.create({
    data: {
      email,
      username,
      nickname,
      passwordHash,
      locale: 'zh',
      status: 'ACTIVE',
    },
  });
}

async function ensurePendingKycCreators() {
  const defs = [
    {
      email: 'seed-pending-kyc-1@velvet.local',
      username: 'seed_kyc_1',
      displayName: 'Seed KYC Pending Lan',
      cccdNumber: '079203001111',
      taxCode: 'SEED-TAX-001',
      bank: { bank: 'Vietcombank', account: '0123456789', name: 'Nguyen Thi Lan' },
    },
    {
      email: 'seed-pending-kyc-2@velvet.local',
      username: 'seed_kyc_2',
      displayName: 'Seed KYC Pending Minh',
      cccdNumber: '079203002222',
      taxCode: 'SEED-TAX-002',
      bank: { bank: 'Techcombank', account: '9876543210', name: 'Tran Van Minh' },
    },
    {
      email: 'seed-pending-kyc-3@velvet.local',
      username: 'seed_kyc_3',
      displayName: 'Seed KYC Pending Hoa',
      cccdNumber: '079203003333',
      taxCode: null,
      bank: { bank: 'MB Bank', account: '1122334455', name: 'Le Thi Hoa' },
    },
    {
      email: 'seed-pending-kyc-4@velvet.local',
      username: 'seed_kyc_4',
      displayName: 'Seed KYC Pending Duc',
      cccdNumber: '079203004444',
      taxCode: 'SEED-TAX-004',
      bank: { bank: 'BIDV', account: '5566778899', name: 'Pham Van Duc' },
    },
  ];

  const out = [];
  for (const d of defs) {
    const user = await ensureUser({
      email: d.email,
      username: d.username,
      nickname: d.displayName,
    });
    const creator = await prisma.creator.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        creatorType: 'INDIVIDUAL',
        displayName: d.displayName,
        kycStatus: 'PENDING',
        cccdNumber: d.cccdNumber,
        cccdFrontUrl: `https://picsum.photos/seed/${SEED_MARK}-front-${d.username}/800/500`,
        cccdBackUrl: `https://picsum.photos/seed/${SEED_MARK}-back-${d.username}/800/500`,
        faceVerified: false,
        taxCode: d.taxCode,
        bankAccount: d.bank,
        bankVerified: false,
        revenueShare: 0.7,
        status: 'ACTIVE',
      },
      update: {
        displayName: d.displayName,
        kycStatus: 'PENDING',
        cccdNumber: d.cccdNumber,
        cccdFrontUrl: `https://picsum.photos/seed/${SEED_MARK}-front-${d.username}/800/500`,
        cccdBackUrl: `https://picsum.photos/seed/${SEED_MARK}-back-${d.username}/800/500`,
        kycRejectReason: null,
        faceVerified: false,
        taxCode: d.taxCode,
        bankAccount: d.bank,
        bankVerified: false,
        status: 'ACTIVE',
      },
    });
    out.push({ email: d.email, creatorId: creator.id.toString(), displayName: d.displayName });
  }
  return out;
}

async function ensureWithdrawCreatorsAndRequests() {
  const defs = [
    {
      email: 'seed-withdraw-1@velvet.local',
      username: 'seed_wd_1',
      displayName: 'Seed Withdraw An',
      amount: 250_000n,
      bank: { bank: 'Vietcombank', account: '1010101010', name: 'Hoang Thi An', holder: 'Hoang Thi An' },
      available: 5_000_000n,
    },
    {
      email: 'seed-withdraw-2@velvet.local',
      username: 'seed_wd_2',
      displayName: 'Seed Withdraw Bao',
      amount: 500_000n,
      bank: { bank: 'VPBank', account: '2020202020', name: 'Nguyen Van Bao' },
      available: 8_000_000n,
    },
    {
      email: 'seed-withdraw-3@velvet.local',
      username: 'seed_wd_3',
      displayName: 'Seed Withdraw Chi',
      amount: 1_200_000n,
      bank: { bank: 'ACB', account: '3030303030', holder: 'Pham Thi Chi' },
      available: 3_500_000n,
    },
    {
      email: 'seed-withdraw-4@velvet.local',
      username: 'seed_wd_4',
      displayName: 'Seed Withdraw Dung',
      amount: 100_000n,
      bank: { bank: 'Sacombank', account: '4040404040', name: 'Vo Van Dung' },
      available: 2_000_000n,
    },
  ];

  const out = [];
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i];
    const user = await ensureUser({
      email: d.email,
      username: d.username,
      nickname: d.displayName,
    });
    const creator = await prisma.creator.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        creatorType: 'INDIVIDUAL',
        displayName: d.displayName,
        kycStatus: 'APPROVED',
        cccdNumber: `07920900${1000 + i}`,
        faceVerified: true,
        taxCode: `SEED-WD-TAX-${i + 1}`,
        bankAccount: d.bank,
        bankVerified: true,
        revenueShare: 0.7,
        status: 'ACTIVE',
      },
      update: {
        displayName: d.displayName,
        kycStatus: 'APPROVED',
        faceVerified: true,
        bankAccount: d.bank,
        bankVerified: true,
        status: 'ACTIVE',
      },
    });

    await prisma.creatorEarning.upsert({
      where: { creatorId: creator.id },
      create: {
        creatorId: creator.id,
        availableVnd: d.available,
        pendingVnd: d.amount,
        withdrawnVnd: 0n,
        totalEarnedVnd: d.available + d.amount,
      },
      update: {
        availableVnd: d.available,
        pendingVnd: d.amount,
        totalEarnedVnd: d.available + d.amount,
      },
    });

    const requestNo = genRequestNo(i + 1);
    const pitRate = 0.05;
    const pitVnd = BigInt(Math.floor(Number(d.amount) * pitRate));
    const netVnd = d.amount - pitVnd;
    // Age some requests >24h for overdue styling
    const createdAt = new Date(Date.now() - (i === 0 ? 36 : i === 1 ? 6 : 2) * 3600_000);

    const existing = await prisma.withdrawRequest.findUnique({ where: { requestNo } });
    const row = existing
      ? await prisma.withdrawRequest.update({
          where: { requestNo },
          data: {
            creatorId: creator.id,
            amountVnd: d.amount,
            bankInfo: d.bank,
            status: 'PENDING',
            rejectReason: null,
            paidAt: null,
            pitRate,
            pitVnd,
            netVnd,
            createdAt,
          },
        })
      : await prisma.withdrawRequest.create({
          data: {
            requestNo,
            creatorId: creator.id,
            amountVnd: d.amount,
            bankInfo: d.bank,
            status: 'PENDING',
            pitRate,
            pitVnd,
            netVnd,
            createdAt,
          },
        });

    out.push({
      requestNo: row.requestNo,
      amountVnd: row.amountVnd.toString(),
      creator: d.displayName,
      email: d.email,
    });
  }
  return out;
}

async function ensurePendingDramas() {
  // Reuse first withdraw creator + a dedicated review creator
  const hostUser = await ensureUser({
    email: 'seed-drama-reviewer@velvet.local',
    username: 'seed_drama_rev',
    nickname: 'Seed Drama Reviewer',
  });
  const hostCreator = await prisma.creator.upsert({
    where: { userId: hostUser.id },
    create: {
      userId: hostUser.id,
      creatorType: 'INDIVIDUAL',
      displayName: 'Seed Indie Studio',
      kycStatus: 'APPROVED',
      faceVerified: true,
      bankVerified: true,
      bankAccount: { bank: 'Vietcombank', account: '7777777777', name: 'Seed Indie Studio' },
      revenueShare: 0.7,
      status: 'ACTIVE',
    },
    update: {
      displayName: 'Seed Indie Studio',
      kycStatus: 'APPROVED',
      status: 'ACTIVE',
    },
  });

  const dramaDefs = [
    {
      slug: 'seed-pending-drama-01',
      titleEn: 'Seed Pending: Midnight Secret',
      titleZh: '种子待审·午夜秘密',
      category: 'romance',
      episodes: 3,
    },
    {
      slug: 'seed-pending-drama-02',
      titleEn: 'Seed Pending: City Chase',
      titleZh: '种子待审·都市追击',
      category: 'action',
      episodes: 2,
    },
    {
      slug: 'seed-pending-drama-03',
      titleEn: 'Seed Pending: Laugh Track',
      titleZh: '种子待审·笑声不断',
      category: 'comedy',
      episodes: 2,
    },
    {
      slug: 'seed-pending-drama-04',
      titleEn: 'Seed Pending: Palace Rumour',
      titleZh: '种子待审·宫廷传闻',
      category: 'costume',
      episodes: 3,
    },
  ];

  const out = [];
  for (const d of dramaDefs) {
    const drama = await prisma.drama.upsert({
      where: { slug: d.slug },
      create: {
        slug: d.slug,
        creatorId: hostCreator.id,
        titleEn: d.titleEn,
        titleZh: d.titleZh,
        descriptionEn: `${SEED_MARK} unofficial drama for Ops review UI.`,
        descriptionZh: '本地种子：非官方待审剧集，供 Ops 剧集管理审核样式检查。',
        categorySlug: d.category,
        tags: ['seed', 'pending-review'],
        coverUrl: `https://picsum.photos/seed/${d.slug}/600/800`,
        totalEpisodes: d.episodes,
        freeEpisodeCount: 1,
        status: 'PENDING_REVIEW',
        sourceType: 'ONLINE',
        isOfficial: false,
        isFeatured: false,
        licenseType: 'AUTHORIZED',
      },
      update: {
        creatorId: hostCreator.id,
        titleEn: d.titleEn,
        titleZh: d.titleZh,
        status: 'PENDING_REVIEW',
        sourceType: 'ONLINE',
        isOfficial: false,
        categorySlug: d.category,
        coverUrl: `https://picsum.photos/seed/${d.slug}/600/800`,
        totalEpisodes: d.episodes,
        takedownAt: null,
        takedownReason: null,
      },
    });

    // Replace episodes so numbering is continuous and media is approve-ready
    await prisma.episode.deleteMany({ where: { dramaId: drama.id } });
    for (let ep = 1; ep <= d.episodes; ep++) {
      const isFree = ep === 1;
      // External http URL (not our CDN) → readiness skips COMPLETED transcoder check
      const hlsUrl = `https://example.com/seed/${d.slug}/ep${ep}/playlist.m3u8`;
      await prisma.episode.create({
        data: {
          dramaId: drama.id,
          episodeNumber: ep,
          title: `EP${ep}`,
          hlsUrl,
          originalUrl: hlsUrl,
          durationSec: 90 + ep * 5,
          isFree,
          previewSeconds: isFree ? 0 : 15,
          priceVnd: isFree ? 0n : 10000n,
          priceCredits: isFree ? 0n : 10n,
          uploadStatus: 'COMPLETED',
          transcodeStatus: 'COMPLETED',
          sourceProvider: 'seed',
          externalVideoId: `${d.slug}-ep${ep}`,
        },
      });
    }

    out.push({
      slug: d.slug,
      id: drama.id.toString(),
      titleZh: d.titleZh,
      episodes: d.episodes,
    });
  }
  return out;
}

async function main() {
  assertLocalDb(process.env.DATABASE_URL);
  console.log(`[seed-local-pending] env=${envPath || '(process env)'} db=${process.env.DATABASE_URL.replace(/:([^:@]+)@/, ':***@')}`);

  await ensureCategories();
  const kyc = await ensurePendingKycCreators();
  const withdraws = await ensureWithdrawCreatorsAndRequests();
  const dramas = await ensurePendingDramas();

  const [pendingKyc, pendingWithdraw, pendingDrama] = await Promise.all([
    prisma.creator.count({ where: { kycStatus: 'PENDING' } }),
    prisma.withdrawRequest.count({ where: { status: 'PENDING' } }),
    prisma.drama.count({ where: { status: 'PENDING_REVIEW', isOfficial: false } }),
  ]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        insertedOrUpdated: { kyc, withdraws, dramas },
        totals: { pendingKyc, pendingWithdraw, pendingUnofficialDrama: pendingDrama },
        adminLogin: {
          email: process.env.ADMIN_BOOTSTRAP_EMAIL || 'admin@velvet.local',
          password: process.env.ADMIN_BOOTSTRAP_PASSWORD || 'admin',
          username: process.env.ADMIN_BOOTSTRAP_USERNAME || 'admin',
        },
        creatorTestPassword: TEST_PASSWORD,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error('[seed-local-pending] FAILED', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

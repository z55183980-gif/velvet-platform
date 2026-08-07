import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import { AuditService } from '../common/audit.service';

export interface DramaListFilter {
  q?: string;
  status?: 'DRAFT' | 'PENDING_REVIEW' | 'LIVE' | 'OFFLINE' | 'REJECTED' | 'ALL';
  categorySlug?: string;
  creatorId?: string;
  isOfficial?: '1' | '0';
  isFeatured?: '1' | '0';
  isHottest?: '1' | '0';
  /** owned = 自有成片(R2+LOCAL)；online = 在线引用；r2/local 为兼容旧筛选项 */
  mediaKind?: 'owned' | 'online' | 'r2' | 'local';
  /** weight | latest(publishedAt) | views | unlocks | created */
  sort?: 'weight' | 'latest' | 'views' | 'unlocks' | 'created';
  /** 时间范围字段：上架时间或创建时间 */
  dateField?: 'publishedAt' | 'createdAt';
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

function parseDayBound(raw?: string, endOfDay = false): Date | null {
  if (!raw || !String(raw).trim()) return null;
  const s = String(raw).trim();
  // YYYY-MM-DD → local calendar day bound in UTC-safe ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(endOfDay ? `${s}T23:59:59.999Z` : `${s}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(filter: DramaListFilter) {
    const page = Math.max(1, Math.floor(filter.page ?? 1));
    const pageSize = Math.min(100, Math.max(5, Math.floor(filter.pageSize ?? 20)));
    const where: any = {};
    if (filter.status && filter.status !== 'ALL') where.status = filter.status;
    if (filter.categorySlug) where.categorySlug = filter.categorySlug;
    if (filter.creatorId) {
      try {
        where.creatorId = BigInt(filter.creatorId);
      } catch {
        where.creatorId = -1n; // invalid id → empty result
      }
    }
    if (filter.isOfficial === '1') where.isOfficial = true;
    if (filter.isOfficial === '0') where.isOfficial = false;
    if (filter.isFeatured === '1') where.isFeatured = true;
    if (filter.isFeatured === '0') where.isFeatured = false;
    if (filter.isHottest === '1') where.isHottest = true;
    if (filter.isHottest === '0') where.isHottest = false;
    if (filter.mediaKind === 'online') {
      where.sourceType = 'ONLINE';
    } else if (filter.mediaKind === 'owned') {
      where.sourceType = { in: ['R2', 'LOCAL'] };
    } else if (filter.mediaKind === 'r2') {
      where.sourceType = 'R2';
    } else if (filter.mediaKind === 'local') {
      where.sourceType = 'LOCAL';
    }
    const dateField = filter.dateField === 'createdAt' ? 'createdAt' : 'publishedAt';
    const from = parseDayBound(filter.dateFrom, false);
    const to = parseDayBound(filter.dateTo, true);
    if (from || to) {
      where[dateField] = {};
      if (from) where[dateField].gte = from;
      if (to) where[dateField].lte = to;
    }
    if (filter.q) {
      where.OR = [
        { titleEn: { contains: filter.q, mode: 'insensitive' } },
        { titleZh: { contains: filter.q, mode: 'insensitive' } },
        { slug: { contains: filter.q, mode: 'insensitive' } },
        { creator: { displayName: { contains: filter.q, mode: 'insensitive' } } },
      ];
    }
    const orderBy =
      filter.isHottest === '1'
        ? [{ hottestSortOrder: 'asc' as const }, { updatedAt: 'desc' as const }]
        : filter.sort === 'latest'
          ? [{ publishedAt: 'desc' as const }, { updatedAt: 'desc' as const }]
          : filter.sort === 'created'
            ? [{ createdAt: 'desc' as const }]
            : filter.sort === 'views'
              ? [{ viewCount: 'desc' as const }, { updatedAt: 'desc' as const }]
              : filter.sort === 'unlocks'
                ? [{ unlockCount: 'desc' as const }, { updatedAt: 'desc' as const }]
                : [{ sortWeight: 'desc' as const }, { updatedAt: 'desc' as const }];
    const [rows, total] = await Promise.all([
      this.prisma.drama.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          category: true,
          creator: { select: { id: true, displayName: true, kycStatus: true } },
          _count: { select: { episodes: true } },
        },
      }),
      this.prisma.drama.count({ where }),
    ]);
    return { rows, total, page, pageSize };
  }

  async detail(id: string) {
    const drama = await this.prisma.drama.findUnique({
      where: { id: BigInt(id) },
      include: {
        category: true,
        creator: { select: { id: true, displayName: true, kycStatus: true, userId: true } },
        episodes: {
          orderBy: { episodeNumber: 'asc' },
          select: {
            id: true,
            episodeNumber: true,
            title: true,
            isFree: true,
            priceCredits: true,
            priceVnd: true,
            hlsUrl: true,
            originalUrl: true,
            thumbnailUrl: true,
            transcodeStatus: true,
            uploadStatus: true,
            durationSec: true,
            viewCount: true,
            unlockCount: true,
          },
        },
        _count: { select: { favorites: true } },
      },
    });
    if (!drama) throw new BizException(BizCode.NOT_FOUND, 'drama.notFound');
    return drama;
  }

  async setFeatured(id: string, value: boolean, actorId?: bigint) {
    const drama = await this.prisma.drama.update({
      where: { id: BigInt(id) },
      data: { isFeatured: value },
    });
    await this.audit.write({
      actorId,
      action: 'drama.setFeatured',
      targetType: 'drama',
      targetId: id,
      payload: { isFeatured: value },
    });
    return { id: drama.id.toString(), isFeatured: drama.isFeatured };
  }

  async setOfficial(id: string, value: boolean, actorId?: bigint) {
    const drama = await this.prisma.drama.update({
      where: { id: BigInt(id) },
      data: { isOfficial: value },
    });
    await this.audit.write({
      actorId,
      action: 'drama.setOfficial',
      targetType: 'drama',
      targetId: id,
      payload: { isOfficial: value },
    });
    return { id: drama.id.toString(), isOfficial: drama.isOfficial };
  }

  async setSortWeight(id: string, weight: number, actorId?: bigint) {
    const drama = await this.prisma.drama.update({
      where: { id: BigInt(id) },
      data: { sortWeight: Math.floor(weight) },
    });
    await this.audit.write({
      actorId,
      action: 'drama.setSortWeight',
      targetType: 'drama',
      targetId: id,
      payload: { sortWeight: drama.sortWeight },
    });
    return { id: drama.id.toString(), sortWeight: drama.sortWeight };
  }

  async listHottest() {
    return this.prisma.drama.findMany({
      where: { isHottest: true },
      orderBy: [{ hottestSortOrder: 'asc' }, { updatedAt: 'desc' }],
      take: 200,
      include: {
        category: true,
        creator: { select: { id: true, displayName: true } },
        _count: { select: { episodes: true } },
      },
    });
  }

  async setHottest(id: string, value: boolean, actorId?: bigint) {
    const dramaId = BigInt(id);
    let hottestSortOrder = 0;
    if (value) {
      const agg = await this.prisma.drama.aggregate({
        where: { isHottest: true },
        _max: { hottestSortOrder: true },
      });
      hottestSortOrder = (agg._max.hottestSortOrder ?? -1) + 1;
    }
    const drama = await this.prisma.drama.update({
      where: { id: dramaId },
      data: { isHottest: value, hottestSortOrder: value ? hottestSortOrder : 0 },
    });
    await this.audit.write({
      actorId,
      action: 'drama.setHottest',
      targetType: 'drama',
      targetId: id,
      payload: { isHottest: value, hottestSortOrder: drama.hottestSortOrder },
    });
    return {
      id: drama.id.toString(),
      isHottest: drama.isHottest,
      hottestSortOrder: drama.hottestSortOrder,
    };
  }

  async setHottestSortOrder(id: string, sortOrder: number, actorId?: bigint) {
    const drama = await this.prisma.drama.update({
      where: { id: BigInt(id) },
      data: { hottestSortOrder: Math.floor(sortOrder) },
    });
    await this.audit.write({
      actorId,
      action: 'drama.setHottestSortOrder',
      targetType: 'drama',
      targetId: id,
      payload: { hottestSortOrder: drama.hottestSortOrder },
    });
    return { id: drama.id.toString(), hottestSortOrder: drama.hottestSortOrder };
  }

  async reorderHottest(ids: string[], actorId?: bigint) {
    const unique = [...new Set(ids.map(String).filter((x) => /^\d+$/.test(x)))];
    await this.prisma.$transaction(
      unique.map((id, index) =>
        this.prisma.drama.update({
          where: { id: BigInt(id) },
          data: { isHottest: true, hottestSortOrder: index },
        }),
      ),
    );
    await this.audit.write({
      actorId,
      action: 'drama.reorderHottest',
      targetType: 'drama',
      targetId: 'hottest',
      payload: { ids: unique },
    });
    return { ok: true, count: unique.length };
  }

  /** 一页式的官方/精选/排序概览 */
  async ranking() {
    const [official, featured, topByUnlock, topByView] = await Promise.all([
      this.prisma.drama.findMany({
        where: { isOfficial: true },
        orderBy: [{ sortWeight: 'desc' }, { updatedAt: 'desc' }],
        take: 50,
        select: { id: true, titleEn: true, titleZh: true, slug: true, sortWeight: true },
      }),
      this.prisma.drama.findMany({
        where: { isFeatured: true },
        orderBy: [{ sortWeight: 'desc' }, { updatedAt: 'desc' }],
        take: 50,
        select: { id: true, titleEn: true, titleZh: true, slug: true, sortWeight: true },
      }),
      this.prisma.drama.findMany({
        orderBy: { unlockCount: 'desc' },
        take: 20,
        select: { id: true, titleEn: true, titleZh: true, slug: true, unlockCount: true, viewCount: true },
      }),
      this.prisma.drama.findMany({
        orderBy: { viewCount: 'desc' },
        take: 20,
        select: { id: true, titleEn: true, titleZh: true, slug: true, unlockCount: true, viewCount: true },
      }),
    ]);
    return { official, featured, topByUnlock, topByView };
  }
}

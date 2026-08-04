import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import { AuditService } from '../common/audit.service';

export interface DramaListFilter {
  q?: string;
  status?: 'DRAFT' | 'PENDING_REVIEW' | 'LIVE' | 'OFFLINE' | 'REJECTED' | 'ALL';
  categorySlug?: string;
  isOfficial?: '1' | '0';
  isFeatured?: '1' | '0';
  isHottest?: '1' | '0';
  page?: number;
  pageSize?: number;
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
    if (filter.isOfficial === '1') where.isOfficial = true;
    if (filter.isOfficial === '0') where.isOfficial = false;
    if (filter.isFeatured === '1') where.isFeatured = true;
    if (filter.isFeatured === '0') where.isFeatured = false;
    if (filter.isHottest === '1') where.isHottest = true;
    if (filter.isHottest === '0') where.isHottest = false;
    if (filter.q) {
      where.OR = [
        { titleVi: { contains: filter.q, mode: 'insensitive' } },
        { titleZh: { contains: filter.q, mode: 'insensitive' } },
        { slug: { contains: filter.q, mode: 'insensitive' } },
        { creator: { displayName: { contains: filter.q, mode: 'insensitive' } } },
      ];
    }
    const orderBy =
      filter.isHottest === '1'
        ? [{ hottestSortOrder: 'asc' as const }, { updatedAt: 'desc' as const }]
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
    if (!drama) throw new BizException(BizCode.NOT_FOUND, 'Không tìm thấy phim');
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
        select: { id: true, titleVi: true, titleZh: true, slug: true, sortWeight: true },
      }),
      this.prisma.drama.findMany({
        where: { isFeatured: true },
        orderBy: [{ sortWeight: 'desc' }, { updatedAt: 'desc' }],
        take: 50,
        select: { id: true, titleVi: true, titleZh: true, slug: true, sortWeight: true },
      }),
      this.prisma.drama.findMany({
        orderBy: { unlockCount: 'desc' },
        take: 20,
        select: { id: true, titleVi: true, titleZh: true, slug: true, unlockCount: true, viewCount: true },
      }),
      this.prisma.drama.findMany({
        orderBy: { viewCount: 'desc' },
        take: 20,
        select: { id: true, titleVi: true, titleZh: true, slug: true, unlockCount: true, viewCount: true },
      }),
    ]);
    return { official, featured, topByUnlock, topByView };
  }
}

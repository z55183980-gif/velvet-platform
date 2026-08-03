import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DramasService {
  constructor(private readonly prisma: PrismaService) {}

  async listDramas(opts: {
    category?: string;
    q?: string;
    tag?: string;
    page?: number;
    pageSize?: number;
    sort?: 'latest' | 'hot';
  }) {
    const page = opts.page || 1;
    const pageSize = opts.pageSize || 12;
    const where: any = { status: 'LIVE' };
    if (opts.category) where.categorySlug = opts.category;
    if (opts.tag) where.tags = { has: opts.tag };
    if (opts.q) {
      where.OR = [
        { titleVi: { contains: opts.q, mode: 'insensitive' } },
        { titleZh: { contains: opts.q, mode: 'insensitive' } },
      ];
    }
    const orderBy =
      opts.sort === 'hot'
        ? [{ viewCount: 'desc' as const }, { unlockCount: 'desc' as const }]
        : [{ publishedAt: 'desc' as const }];

    const [rows, total] = await Promise.all([
      this.prisma.drama.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          creator: {
            select: {
              displayName: true,
              creatorType: true,
              user: { select: { avatarUrl: true } },
            },
          },
          category: true,
        },
      }),
      this.prisma.drama.count({ where }),
    ]);
    return {
      rows: rows.map((d) => ({
        ...d,
        creator: d.creator
          ? {
              displayName: d.creator.displayName,
              creatorType: d.creator.creatorType,
              avatarUrl: d.creator.user?.avatarUrl ?? null,
            }
          : null,
      })),
      total,
      page,
      pageSize,
    };
  }

  async getDrama(id: string) {
    const drama = await this.prisma.drama.findUnique({
      where: this.resolveDramaWhere(id),
      include: {
        creator: {
          select: {
            displayName: true,
            creatorType: true,
            user: { select: { avatarUrl: true } },
          },
        },
        category: true,
        episodes: {
          orderBy: { episodeNumber: 'asc' },
          select: {
            id: true,
            episodeNumber: true,
            title: true,
            isFree: true,
            priceVnd: true,
            priceCredits: true,
            durationSec: true,
            thumbnailUrl: true,
          },
        },
      },
    });
    if (!drama) return null;
    return {
      ...drama,
      creator: drama.creator
        ? {
            displayName: drama.creator.displayName,
            creatorType: drama.creator.creatorType,
            avatarUrl: drama.creator.user?.avatarUrl ?? null,
          }
        : null,
    };
  }

  async getEpisodes(dramaId: string, userId?: bigint) {
    const drama = await this.prisma.drama.findUnique({
      where: this.resolveDramaWhere(dramaId),
      select: { id: true, freeEpisodeCount: true, creatorId: true, buyoutCredits: true },
    });
    if (!drama) return null;
    const episodes = await this.prisma.episode.findMany({
      where: { dramaId: drama.id },
      orderBy: { episodeNumber: 'asc' },
    });
    let unlockedSet = new Set<string>();
    let vipActive = false;
    let dramaUnlocked = false;
    if (userId) {
      const [unlocks, user, dUnlock] = await Promise.all([
        this.prisma.userUnlock.findMany({
          where: { userId, episodeId: { in: episodes.map((e) => e.id) } },
          select: { episodeId: true },
        }),
        this.prisma.user.findUnique({ where: { id: userId }, select: { vipExpireAt: true } }),
        this.prisma.userDramaUnlock.findUnique({
          where: { userId_dramaId: { userId, dramaId: drama.id } },
        }),
      ]);
      unlockedSet = new Set(unlocks.map((u) => u.episodeId.toString()));
      vipActive = !!(user?.vipExpireAt && user.vipExpireAt.getTime() > Date.now());
      dramaUnlocked = !!dUnlock;
    }
    const rows = episodes.map((ep) => {
      const free = ep.isFree || ep.episodeNumber <= drama.freeEpisodeCount;
      return {
        id: ep.id.toString(),
        episodeNumber: ep.episodeNumber,
        title: ep.title,
        isFree: free,
        priceVnd: ep.priceVnd.toString(),
        priceCredits: ep.priceCredits.toString(),
        durationSec: ep.durationSec,
        thumbnailUrl: ep.thumbnailUrl,
        unlocked: free || vipActive || dramaUnlocked || unlockedSet.has(ep.id.toString()),
        // 禁止返回永久片源；播放走 /episodes/:id/play 短时签名
      };
    });
    return {
      dramaId,
      freeEpisodeCount: drama.freeEpisodeCount,
      buyoutCredits: drama.buyoutCredits?.toString() ?? null,
      vipActive,
      dramaUnlocked,
      rows,
    };
  }

  async getFeatured(limit = 12) {
    return this.prisma.drama.findMany({
      where: { status: 'LIVE', OR: [{ isOfficial: true }, { isFeatured: true }] },
      // 运营可调 sortWeight（越大越靠前）；其次官方 → 发布时间
      orderBy: [
        { sortWeight: 'desc' },
        { isOfficial: 'desc' },
        { publishedAt: 'desc' },
      ],
      take: limit,
      include: { creator: { select: { displayName: true, creatorType: true } }, category: true },
    });
  }

  async listCategories() {
    return this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async listBanners() {
    const now = new Date();
    return this.prisma.banner.findMany({
      where: { isActive: true, startAt: { lte: now }, endAt: { gte: now } },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async incView(dramaId: string) {
    await this.prisma.drama.update({
      where: this.resolveDramaWhere(dramaId),
      data: { viewCount: { increment: 1 } },
    });
  }

  private resolveDramaWhere(id: string): { id: bigint } | { uuid: string } | { slug: string } {
    if (/^\d+$/.test(id)) return { id: BigInt(id) };
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) return { uuid: id };
    return { slug: id };
  }
}

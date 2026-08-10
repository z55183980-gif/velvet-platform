import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LockAccessService } from '../common/lock-access.service';
import { resolveCategorySlugAlias } from '../admin/drama-category-infer.util';
import { escapeIlikePattern, isDramaSystemTag, toPublicDramaTags } from './drama-tags';

type FeedRankCache = {
  at: number;
  pinCount: number;
  pinIds: bigint[];
  heatIds: bigint[];
};

@Injectable()
export class DramasService {
  private feedRankCache: FeedRankCache | null = null;
  private readonly feedRankTtlMs = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lockAccess: LockAccessService,
  ) {}

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
    if (opts.category) {
      where.categorySlug = resolveCategorySlugAlias(opts.category);
    }
    if (opts.tag) {
      const parts = String(opts.tag)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length === 1) where.tags = { has: parts[0] };
      else if (parts.length > 1) where.tags = { hasEvery: parts };
    }

    const q = typeof opts.q === 'string' ? opts.q.trim() : '';
    if (q) {
      // Title substring OR public (non-system) tag substring. Prisma cannot express
      // "array element ILIKE", so prefetch matching ids then filter with findMany.
      const ids = await this.findLiveDramaIdsByQuery(q);
      if (ids.length === 0) {
        return { rows: [], total: 0, page, pageSize };
      }
      where.id = { in: ids };
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
      rows: rows.map((d) => this.mapListDrama(d)),
      total,
      page,
      pageSize,
    };
  }

  /**
   * LIVE dramas whose EN/ZH title or a public user tag contains `q` (case-insensitive).
   * System provenance tags (upload/r2/type:/completion:/ytdlp*) are ignored.
   */
  private async findLiveDramaIdsByQuery(q: string): Promise<bigint[]> {
    const pattern = `%${escapeIlikePattern(q)}%`;
    const rows = await this.prisma.$queryRaw<Array<{ id: bigint }>>`
      SELECT d.id
        FROM dramas d
       WHERE d.status = 'LIVE'
         AND (
           d."titleEn" ILIKE ${pattern} ESCAPE '\'
           OR d."titleZh" ILIKE ${pattern} ESCAPE '\'
           OR d."titleFr" ILIKE ${pattern} ESCAPE '\'
           OR EXISTS (
             SELECT 1
               FROM unnest(d.tags) AS t(tag)
              WHERE t.tag ILIKE ${pattern} ESCAPE '\'
                AND t.tag NOT IN ('upload', 'r2', 'transfer', 'ytdlp')
                AND t.tag NOT LIKE 'ytdlp%'
                AND t.tag NOT LIKE 'type:%'
                AND t.tag NOT LIKE 'completion:%'
           )
         )
    `;
    return rows.map((r) => r.id);
  }

  /**
   * Mobile home vertical feed:
   * - Page 1 prefix: ops hottest shelf (pinHottest, default 3)
   * - Rest: 7d watch/unlock heat; sparse traffic falls back to decayed lifetime metrics
   */
  async getHomeFeed(opts: { page?: number; pageSize?: number; pinHottest?: number }) {
    const page = opts.page || 1;
    const pageSize = opts.pageSize || 20;
    const pinHottest = Math.min(10, Math.max(0, opts.pinHottest ?? 3));

    const ranked = await this.getOrBuildFeedRank(pinHottest);
    const orderedIds = [...ranked.pinIds, ...ranked.heatIds];
    const total = orderedIds.length;
    const start = (page - 1) * pageSize;
    const pageIds = orderedIds.slice(start, start + pageSize);

    if (pageIds.length === 0) {
      return { rows: [], total, page, pageSize, hasMore: false };
    }

    const rows = await this.prisma.drama.findMany({
      where: { id: { in: pageIds }, status: 'LIVE' },
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
    });
    const byId = new Map(rows.map((d) => [d.id.toString(), d]));
    const ordered = pageIds
      .map((id) => byId.get(id.toString()))
      .filter((d): d is NonNullable<typeof d> => !!d);

    return {
      rows: ordered.map((d) => this.mapListDrama(d)),
      total,
      page,
      pageSize,
      hasMore: start + pageIds.length < total,
    };
  }

  private async getOrBuildFeedRank(pinHottest: number): Promise<FeedRankCache> {
    const now = Date.now();
    if (
      this.feedRankCache &&
      now - this.feedRankCache.at < this.feedRankTtlMs &&
      this.feedRankCache.pinCount === pinHottest
    ) {
      return this.feedRankCache;
    }
    const built = await this.buildFeedRank(pinHottest);
    this.feedRankCache = built;
    return built;
  }

  private async buildFeedRank(pinHottest: number): Promise<FeedRankCache> {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60_000);

    const [hottest, live, watchGroups, unlockRows] = await Promise.all([
      this.prisma.drama.findMany({
        where: { status: 'LIVE', isHottest: true },
        orderBy: [{ hottestSortOrder: 'asc' }, { publishedAt: 'desc' }],
        select: { id: true },
        take: Math.max(pinHottest, 48),
      }),
      this.prisma.drama.findMany({
        where: { status: 'LIVE' },
        select: {
          id: true,
          viewCount: true,
          unlockCount: true,
          publishedAt: true,
          createdAt: true,
        },
      }),
      this.prisma.watchHistory.groupBy({
        by: ['dramaId'],
        where: { watchedAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.userUnlock.findMany({
        where: { unlockedAt: { gte: since } },
        select: { episode: { select: { dramaId: true } } },
      }),
    ]);

    const watchMap = new Map<string, number>();
    for (const g of watchGroups) {
      watchMap.set(g.dramaId.toString(), g._count._all);
    }

    const unlockMap = new Map<string, number>();
    for (const row of unlockRows) {
      const id = row.episode.dramaId.toString();
      unlockMap.set(id, (unlockMap.get(id) || 0) + 1);
    }

    const nowMs = Date.now();
    const scored = live.map((d) => {
      const id = d.id.toString();
      const watches7d = watchMap.get(id) || 0;
      const unlocks7d = unlockMap.get(id) || 0;
      const published = (d.publishedAt || d.createdAt).getTime();
      const ageDays = Math.max(0, (nowMs - published) / 86_400_000);
      const decay =
        Number(d.viewCount) / (1 + ageDays / 7) +
        (Number(d.unlockCount) * 2) / (1 + ageDays / 14);
      // Real 7d signals dominate; decay fills cold/sparse catalogs.
      const score = watches7d * 10 + unlocks7d * 30 + decay * 0.01;
      return { id: d.id, score };
    });
    scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));

    const pinIds = hottest.slice(0, pinHottest).map((d) => d.id);
    const pinSet = new Set(pinIds.map((id) => id.toString()));
    const heatIds = scored.map((s) => s.id).filter((id) => !pinSet.has(id.toString()));

    return { at: Date.now(), pinCount: pinHottest, pinIds, heatIds };
  }

  private mapListDrama(d: {
    creator?: {
      displayName: string;
      creatorType: string;
      user?: { avatarUrl: string | null } | null;
    } | null;
    tags?: unknown;
    [key: string]: unknown;
  }) {
    return {
      ...d,
      tags: toPublicDramaTags(d.tags),
      creator: d.creator
        ? {
            displayName: d.creator.displayName,
            creatorType: d.creator.creatorType,
            avatarUrl: d.creator.user?.avatarUrl ?? null,
          }
        : null,
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
            previewSeconds: true,
            priceVnd: true,
            priceCredits: true,
            durationSec: true,
            thumbnailUrl: true,
            mediaWidth: true,
            mediaHeight: true,
            mediaOrientation: true,
          },
        },
      },
    });
    // Public catalog: offline / draft titles must not be reachable by old URLs.
    if (!drama || drama.status !== 'LIVE') return null;
    return {
      ...drama,
      tags: toPublicDramaTags(drama.tags),
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
      select: {
        id: true,
        status: true,
        freeEpisodeCount: true,
        lockMode: true,
        creatorId: true,
        buyoutCredits: true,
      },
    });
    if (!drama || drama.status !== 'LIVE') return null;
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
          // Paid purchases only — ignore legacy VIP/free soft unlocks (orderId null)
          where: {
            userId,
            episodeId: { in: episodes.map((e) => e.id) },
            orderId: { not: null },
          },
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
    const policy = await this.lockAccess.resolveForDrama(drama);
    const rows = episodes.map((ep) => {
      const free = this.lockAccess.isFree(ep, policy);
      return {
        id: ep.id.toString(),
        episodeNumber: ep.episodeNumber,
        title: ep.title,
        isFree: free,
        previewSeconds: free ? 0 : ep.previewSeconds,
        priceVnd: ep.priceVnd.toString(),
        priceCredits: ep.priceCredits.toString(),
        durationSec: ep.durationSec,
        thumbnailUrl: ep.thumbnailUrl,
        mediaWidth: ep.mediaWidth,
        mediaHeight: ep.mediaHeight,
        mediaOrientation: ep.mediaOrientation,
        unlocked: free || vipActive || dramaUnlocked || unlockedSet.has(ep.id.toString()),
        // 禁止返回永久片源；播放走 /episodes/:id/play 短时签名
      };
    });
    return {
      dramaId,
      freeEpisodeCount: drama.freeEpisodeCount,
      lockMode: drama.lockMode,
      effectiveLockMode: policy.mode,
      lockModeInherited: policy.inherited,
      buyoutCredits: drama.buyoutCredits?.toString() ?? null,
      vipActive,
      dramaUnlocked,
      rows,
    };
  }

  async getFeatured(limit = 12) {
    const rows = await this.prisma.drama.findMany({
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
    return rows.map((d) => this.mapListDrama(d));
  }

  async getHottest(limit = 48) {
    const rows = await this.prisma.drama.findMany({
      where: { status: 'LIVE', isHottest: true },
      orderBy: [{ hottestSortOrder: 'asc' }, { publishedAt: 'desc' }],
      take: limit,
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
    });
    return rows.map((d) => this.mapListDrama(d));
  }

  async listCategories() {
    return this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /** Distinct public (non-system) tags on LIVE dramas, most used first. */
  async listPublicTags(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ tag: string }>>`
      SELECT t.tag AS tag
        FROM dramas d
        CROSS JOIN LATERAL unnest(d.tags) AS t(tag)
       WHERE d.status = 'LIVE'
       GROUP BY t.tag
       ORDER BY COUNT(*) DESC, t.tag ASC
    `;
    const out: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const tag = String(row.tag || '').trim();
      const key = tag.toLowerCase();
      if (!tag || isDramaSystemTag(tag) || seen.has(key)) continue;
      seen.add(key);
      out.push(tag);
    }
    return out;
  }

  async listBanners() {
    const now = new Date();
    const rows = await this.prisma.banner.findMany({
      where: { isActive: true, startAt: { lte: now }, endAt: { gte: now } },
      orderBy: { sortOrder: 'asc' },
    });
    const dramaIds = [
      ...new Set(
        rows
          .map((b) => b.dramaId)
          .filter((id): id is bigint => id != null),
      ),
    ];
    const dramas =
      dramaIds.length > 0
        ? await this.prisma.drama.findMany({
            where: { id: { in: dramaIds } },
            select: { id: true, titleEn: true, titleZh: true, titleFr: true },
          })
        : [];
    const dramaMap = new Map(dramas.map((d) => [d.id.toString(), d]));

    return rows.map((b) => {
      const drama = b.dramaId != null ? dramaMap.get(b.dramaId.toString()) : undefined;
      // Prefer linked drama titles so C-end locale switching works even when
      // banner.titleEn was mistakenly saved as Chinese (or left identical to titleZh).
      const titleEn = (drama?.titleEn || b.titleEn || '').trim();
      const titleZh = (drama?.titleZh || b.titleZh || titleEn || '').trim();
      const titleFr = (drama?.titleFr || '').trim() || null;
      return {
        id: b.id.toString(),
        titleEn: titleEn || titleZh,
        titleZh: titleZh || titleEn,
        titleFr,
        imageUrl: b.imageUrl,
        linkUrl: b.linkUrl,
        dramaId: b.dramaId != null ? b.dramaId.toString() : null,
        focusX: b.focusX,
        focusY: b.focusY,
        focusZoom: b.focusZoom,
        sortOrder: b.sortOrder,
        startAt: b.startAt,
        endAt: b.endAt,
      };
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

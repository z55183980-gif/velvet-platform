import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: bigint) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { creator: true, wallet: true },
    });
    if (!user) throw new BizException(BizCode.UNAUTHORIZED, 'Người dùng không tồn tại');
    const vipExpireAt = user.vipExpireAt;
    const isVip = !!(vipExpireAt && vipExpireAt.getTime() > Date.now());
    return {
      id: user.id.toString(),
      phone: user.phone,
      email: user.email,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
      locale: user.locale,
      vipExpireAt: vipExpireAt?.toISOString() ?? null,
      isVip,
      isCreator: !!user.creator,
      hasPassword: !!user.passwordHash,
      wallet: user.wallet
        ? {
            balanceCredits: user.wallet.balanceCredits.toString(),
            totalRechargedCredits: user.wallet.totalRechargedCredits.toString(),
            totalSpentCredits: user.wallet.totalSpentCredits.toString(),
          }
        : null,
    };
  }

  async updateMe(userId: bigint, dto: { nickname?: string; avatarUrl?: string; locale?: string }) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        nickname: dto.nickname,
        avatarUrl: dto.avatarUrl,
        locale: dto.locale,
      },
    });
    return { id: user.id.toString(), nickname: user.nickname, locale: user.locale };
  }

  async listFavorites(userId: bigint, page = 1, pageSize = 20, group?: string) {
    const where: any = { userId };
    if (group) where.group = group;
    const [rows, total] = await Promise.all([
      this.prisma.favorite.findMany({
        where,
        orderBy: [{ group: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { drama: { include: { creator: { select: { displayName: true } } } } },
      }),
      this.prisma.favorite.count({ where }),
    ]);
    return {
      rows: rows.map((r) => ({
        id: r.id.toString(),
        dramaId: r.dramaId.toString(),
        group: r.group,
        note: r.note,
        createdAt: r.createdAt,
        drama: r.drama
          ? {
              id: r.drama.id.toString(),
              slug: r.drama.slug,
              titleVi: r.drama.titleVi,
              titleZh: r.drama.titleZh,
              coverUrl: r.drama.coverUrl,
              creator: r.drama.creator,
            }
          : null,
      })),
      total,
      page,
      pageSize,
    };
  }

  async listFavoriteGroups(userId: bigint) {
    const groups = await this.prisma.favorite.findMany({
      where: { userId, group: { not: null } },
      select: { group: true },
      distinct: ['group'],
    });
    return groups.map((g) => g.group).filter(Boolean) as string[];
  }

  async isFavorited(userId: bigint, dramaId: string) {
    if (!/^\d+$/.test(dramaId)) {
      return { favorited: false };
    }
    const row = await this.prisma.favorite.findUnique({
      where: { userId_dramaId: { userId, dramaId: BigInt(dramaId) } },
      select: { id: true },
    });
    return { favorited: !!row };
  }

  async addFavorite(userId: bigint, dramaId: string, dto?: { group?: string; note?: string }) {
    const existed = await this.prisma.favorite.findUnique({
      where: { userId_dramaId: { userId, dramaId: BigInt(dramaId) } },
    });
    await this.prisma.favorite.upsert({
      where: { userId_dramaId: { userId, dramaId: BigInt(dramaId) } },
      create: {
        userId,
        dramaId: BigInt(dramaId),
        group: dto?.group || null,
        note: dto?.note || null,
      },
      update: {
        group: dto?.group ?? undefined,
        note: dto?.note ?? undefined,
      },
    });
    if (!existed) {
      await this.prisma.drama.update({
        where: { id: BigInt(dramaId) },
        data: { favoriteCount: { increment: 1 } },
      });
    }
    return { success: true };
  }

  async updateFavorite(
    userId: bigint,
    dramaId: string,
    dto: { group?: string | null; note?: string | null },
  ) {
    const data: { group?: string | null; note?: string | null } = {};
    if (dto.group !== undefined) {
      const g = dto.group == null ? null : String(dto.group).trim();
      data.group = g || null;
    }
    if (dto.note !== undefined) {
      const n = dto.note == null ? null : String(dto.note).trim();
      data.note = n || null;
    }
    if (Object.keys(data).length === 0) {
      throw new BizException(BizCode.BAD_REQUEST, 'Không có trường nào để cập nhật');
    }
    try {
      await this.prisma.favorite.update({
        where: { userId_dramaId: { userId, dramaId: BigInt(dramaId) } },
        data,
      });
    } catch (e: any) {
      if (e?.code === 'P2025') {
        throw new BizException(BizCode.NOT_FOUND, 'Chưa yêu thích phim này');
      }
      throw e;
    }
    return { success: true };
  }

  async removeFavorite(userId: bigint, dramaId: string) {
    const deleted = await this.prisma.favorite.deleteMany({
      where: { userId, dramaId: BigInt(dramaId) },
    });
    // 仅真实删到记录时递减，避免重复取消导致 favoriteCount 变负
    if (deleted.count > 0) {
      await this.prisma.drama.update({
        where: { id: BigInt(dramaId) },
        data: { favoriteCount: { decrement: 1 } },
      });
    }
    return { success: true };
  }

  async listHistory(userId: bigint, page = 1, pageSize = 20, dramaId?: string) {
    const where: any = { userId };
    if (dramaId) {
      // 支持数字 id 或 slug
      if (/^\d+$/.test(dramaId)) {
        where.dramaId = BigInt(dramaId);
      } else {
        const drama = await this.prisma.drama.findUnique({
          where: { slug: dramaId },
          select: { id: true },
        });
        if (!drama) return { rows: [], total: 0, page, pageSize };
        where.dramaId = drama.id;
      }
    }
    const [rows, total] = await Promise.all([
      this.prisma.watchHistory.findMany({
        where,
        orderBy: { watchedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { id: true, episodeId: true, dramaId: true, progressSec: true, watchedAt: true },
      }),
      this.prisma.watchHistory.count({ where }),
    ]);

    const dramaIds = [...new Set(rows.map((r) => r.dramaId))];
    const episodeIds = [...new Set(rows.map((r) => r.episodeId))];
    const [dramas, episodes] = await Promise.all([
      dramaIds.length
        ? this.prisma.drama.findMany({
            where: { id: { in: dramaIds } },
            select: { id: true, slug: true, titleVi: true, titleZh: true, coverUrl: true },
          })
        : Promise.resolve([]),
      episodeIds.length
        ? this.prisma.episode.findMany({
            where: { id: { in: episodeIds } },
            select: { id: true, episodeNumber: true, title: true },
          })
        : Promise.resolve([]),
    ]);
    const dramaMap = new Map(dramas.map((d) => [d.id.toString(), d] as const));
    const episodeMap = new Map(episodes.map((e) => [e.id.toString(), e] as const));

    return {
      rows: rows.map((r) => {
        const d = dramaMap.get(r.dramaId.toString());
        const e = episodeMap.get(r.episodeId.toString());
        return {
          id: r.id.toString(),
          episodeId: r.episodeId.toString(),
          dramaId: r.dramaId.toString(),
          progressSec: r.progressSec,
          watchedAt: r.watchedAt,
          drama: d
            ? {
                id: d.id.toString(),
                slug: d.slug,
                titleVi: d.titleVi,
                titleZh: d.titleZh,
                coverUrl: d.coverUrl,
              }
            : null,
          episode: e
            ? {
                id: e.id.toString(),
                episodeNumber: e.episodeNumber,
                title: e.title,
              }
            : null,
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  async clearHistory(userId: bigint) {
    await this.prisma.watchHistory.deleteMany({ where: { userId } });
    return { success: true };
  }
}

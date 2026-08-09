import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import { AuditService } from '../common/audit.service';
import { LockAccessService } from '../common/lock-access.service';
import { toBigInt } from '../common/money.util';

@Injectable()
export class AdminOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly lockAccess: LockAccessService,
  ) {}

  async summary(from?: string, to?: string) {
    const wherePaid: any = { paymentStatus: 'PAID' };
    if (from || to) {
      wherePaid.paidAt = {};
      if (from) wherePaid.paidAt.gte = new Date(from);
      if (to) wherePaid.paidAt.lte = new Date(to);
    }

    const [topupAgg, vipAgg, unlockAgg, buyoutAgg, vipUsers] = await Promise.all([
      this.prisma.order.aggregate({
        where: { ...wherePaid, orderType: 'TOPUP' },
        _sum: { amountCredits: true, amountVnd: true },
        _count: true,
      }),
      this.prisma.order.aggregate({
        where: { ...wherePaid, orderType: 'VIP_SUB' },
        _sum: { amountVnd: true },
        _count: true,
      }),
      this.prisma.order.aggregate({
        where: { ...wherePaid, orderType: 'EPISODE_UNLOCK' },
        _sum: { amountCredits: true, amountVnd: true },
        _count: true,
      }),
      this.prisma.order.aggregate({
        where: { ...wherePaid, orderType: 'DRAMA_BUYOUT' },
        _sum: { amountCredits: true, amountVnd: true },
        _count: true,
      }),
      this.prisma.user.count({
        where: { vipExpireAt: { gt: new Date() } },
      }),
    ]);

    return {
      activeVipUsers: vipUsers,
      topup: {
        count: topupAgg._count,
        credits: (topupAgg._sum.amountCredits ?? 0n).toString(),
        amountVnd: (topupAgg._sum.amountVnd ?? 0n).toString(),
      },
      vip: {
        count: vipAgg._count,
        amountVnd: (vipAgg._sum.amountVnd ?? 0n).toString(),
      },
      unlock: {
        count: unlockAgg._count,
        credits: (unlockAgg._sum.amountCredits ?? 0n).toString(),
        amountVnd: (unlockAgg._sum.amountVnd ?? 0n).toString(),
      },
      dramaBuyout: {
        count: buyoutAgg._count,
        credits: (buyoutAgg._sum.amountCredits ?? 0n).toString(),
        amountVnd: (buyoutAgg._sum.amountVnd ?? 0n).toString(),
      },
    };
  }

  async dramaSales(from?: string, to?: string, limit = 50) {
    const where: any = {
      paymentStatus: 'PAID',
      orderType: { in: ['EPISODE_UNLOCK', 'DRAMA_BUYOUT'] },
      dramaId: { not: null },
    };
    if (from || to) {
      where.paidAt = {};
      if (from) where.paidAt.gte = new Date(from);
      if (to) where.paidAt.lte = new Date(to);
    }

    const grouped = await this.prisma.order.groupBy({
      by: ['dramaId'],
      where,
      _count: true,
      _sum: { amountCredits: true, amountVnd: true },
      orderBy: { _sum: { amountCredits: 'desc' } },
      take: Math.min(100, Math.max(1, limit)),
    });

    const dramaIds = grouped.map((g) => g.dramaId!).filter(Boolean);
    const dramas = await this.prisma.drama.findMany({
      where: { id: { in: dramaIds } },
      select: { id: true, slug: true, titleEn: true, titleZh: true, coverUrl: true },
    });
    const map = new Map(dramas.map((d) => [d.id.toString(), d]));

    return grouped.map((g) => {
      const d = map.get(g.dramaId!.toString());
      return {
        dramaId: g.dramaId!.toString(),
        slug: d?.slug ?? null,
        titleEn: d?.titleEn ?? null,
        titleZh: d?.titleZh ?? null,
        coverUrl: d?.coverUrl ?? null,
        orderCount: g._count,
        credits: (g._sum.amountCredits ?? 0n).toString(),
        amountVnd: (g._sum.amountVnd ?? 0n).toString(),
      };
    });
  }

  async batchUpdateDramas(
    dto: {
      ids: (string | number)[];
      freeEpisodeCount?: number;
      lockMode?: 'FREE_FIRST_N' | 'VIP_ALL' | 'ALL_FREE' | 'INHERIT' | null;
      priceCredits?: number | string;
      buyoutCredits?: number | string | null;
      isFeatured?: boolean;
      isOfficial?: boolean;
      sortWeight?: number;
    },
    actorId?: bigint | null,
  ) {
    if (!dto.ids?.length) throw new BizException(BizCode.BAD_REQUEST, 'ids.empty');
    const ids = dto.ids.map((id) => BigInt(id));

    const data: any = {};
    if (dto.freeEpisodeCount != null) {
      const n = Math.floor(Number(dto.freeEpisodeCount));
      if (!Number.isFinite(n) || n < 0) {
        throw new BizException(BizCode.BAD_REQUEST, 'freeEpisodeCount không hợp lệ');
      }
      data.freeEpisodeCount = n;
    }
    if (dto.lockMode !== undefined) {
      if (dto.lockMode === null || dto.lockMode === 'INHERIT') {
        data.lockMode = null;
        // Stamp global freeCount so denormalized drama.freeEpisodeCount stays consistent
        // when caller did not pass an explicit freeEpisodeCount.
        if (dto.freeEpisodeCount == null) {
          const global = await this.lockAccess.getGlobalPolicy();
          data.freeEpisodeCount = global.freeCount;
        }
      } else if (
        dto.lockMode === 'FREE_FIRST_N' ||
        dto.lockMode === 'VIP_ALL' ||
        dto.lockMode === 'ALL_FREE'
      ) {
        data.lockMode = dto.lockMode;
      } else {
        throw new BizException(BizCode.BAD_REQUEST, 'lockMode không hợp lệ');
      }
    }
    if (dto.buyoutCredits !== undefined) {
      if (dto.buyoutCredits === null || dto.buyoutCredits === '' || Number(dto.buyoutCredits) === 0) {
        data.buyoutCredits = null;
      } else {
        const c = toBigInt(dto.buyoutCredits);
        if (c < 0n) throw new BizException(BizCode.BAD_REQUEST, 'buyoutCredits không hợp lệ');
        data.buyoutCredits = c;
      }
    }
    if (dto.isFeatured !== undefined) data.isFeatured = !!dto.isFeatured;
    if (dto.isOfficial !== undefined) data.isOfficial = !!dto.isOfficial;
    if (dto.sortWeight !== undefined) {
      const w = Math.floor(Number(dto.sortWeight));
      if (!Number.isFinite(w)) {
        throw new BizException(BizCode.BAD_REQUEST, 'sortWeight không hợp lệ');
      }
      data.sortWeight = w;
    }

    let dramasUpdated = 0;
    let episodesUpdated = 0;

    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        const r = await tx.drama.updateMany({ where: { id: { in: ids } }, data });
        dramasUpdated = r.count;
      }
      if (dto.priceCredits != null) {
        const price = toBigInt(dto.priceCredits);
        if (price < 0n) throw new BizException(BizCode.BAD_REQUEST, 'priceCredits không hợp lệ');
        // 仅更新付费集（非 isFree）；免费集保持 0；同步 priceVnd 以免分成漂移
        const r = await tx.episode.updateMany({
          where: { dramaId: { in: ids }, isFree: false },
          data: { priceCredits: price, priceVnd: price },
        });
        episodesUpdated = r.count;
      }
    });

    if (dto.lockMode !== undefined || dto.freeEpisodeCount != null) {
      let synced = 0;
      for (const id of ids) {
        synced += await this.lockAccess.syncEpisodeAccessFlags(id, {
          paidCredits: dto.priceCredits != null ? toBigInt(dto.priceCredits) : undefined,
          paidVnd: dto.priceCredits != null ? toBigInt(dto.priceCredits) : undefined,
        });
      }
      episodesUpdated = Math.max(episodesUpdated, synced);
    }

    await this.audit.write({
      actorId,
      action: 'drama.batchUpdate',
      targetType: 'drama',
      payload: {
        ids: ids.map((i) => i.toString()),
        freeEpisodeCount: dto.freeEpisodeCount,
        lockMode: dto.lockMode,
        priceCredits: dto.priceCredits != null ? String(dto.priceCredits) : undefined,
        buyoutCredits: dto.buyoutCredits != null ? String(dto.buyoutCredits) : undefined,
        isFeatured: dto.isFeatured,
        isOfficial: dto.isOfficial,
        sortWeight: dto.sortWeight,
        dramasUpdated,
        episodesUpdated,
      },
    });

    return { dramasUpdated, episodesUpdated };
  }
}

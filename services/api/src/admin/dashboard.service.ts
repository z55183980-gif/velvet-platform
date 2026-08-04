import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type DashboardRange = 'today' | '7d' | '30d';

type KpiBlock = {
  newUsers: number;
  gmvVnd: string;
  unlockCount: number;
  platformRevenueVnd: string;
  paidOrders: number;
};

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** 主仪表盘：周期 KPI + 环比 + 趋势 + 待办 + 排行 + 经营拆分 */
  async overview(rangeInput?: string) {
    const range = this.parseRange(rangeInput);
    const { periodStart, periodEnd, prevStart, prevEnd, trendDays } = this.windowFor(range);

    const [period, previous, trends, todos, rankings, bizBreakdown] = await Promise.all([
      this.kpi(periodStart, periodEnd),
      this.kpi(prevStart, prevEnd),
      this.trends(range === 'today' ? prevStart : periodStart, periodEnd, trendDays),
      this.todoCounts(),
      this.rankings(periodStart, periodEnd),
      this.bizBreakdown(periodStart, periodEnd),
    ]);

    return {
      range,
      period,
      previous,
      deltas: {
        newUsersPct: pctDelta(period.newUsers, previous.newUsers),
        gmvPct: pctDelta(BigInt(period.gmvVnd), BigInt(previous.gmvVnd)),
        unlockPct: pctDelta(period.unlockCount, previous.unlockCount),
        revenuePct: pctDelta(BigInt(period.platformRevenueVnd), BigInt(previous.platformRevenueVnd)),
        ordersPct: pctDelta(period.paidOrders, previous.paidOrders),
      },
      trends,
      todos,
      rankings,
      bizBreakdown,
    };
  }

  private parseRange(input?: string): DashboardRange {
    if (input === 'today' || input === '7d' || input === '30d') return input;
    return '7d';
  }

  /** 半开区间 [start, end)；趋势天数 = 当前窗口自然日数 */
  private windowFor(range: DashboardRange) {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    if (range === 'today') {
      const prevStart = new Date(dayStart);
      prevStart.setDate(prevStart.getDate() - 1);
      return {
        periodStart: dayStart,
        periodEnd: dayEnd,
        prevStart,
        prevEnd: dayStart,
        trendDays: 2,
      };
    }

    const days = range === '7d' ? 7 : 30;
    const periodStart = new Date(dayStart);
    periodStart.setDate(periodStart.getDate() - (days - 1));
    const prevEnd = new Date(periodStart);
    const prevStart = new Date(periodStart);
    prevStart.setDate(prevStart.getDate() - days);

    return {
      periodStart,
      periodEnd: dayEnd,
      prevStart,
      prevEnd,
      trendDays: days,
    };
  }

  private async kpi(start: Date, end: Date): Promise<KpiBlock> {
    const [newUsers, paid, unlockCount] = await Promise.all([
      this.prisma.user.count({ where: { createdAt: { gte: start, lt: end } } }),
      this.prisma.order.aggregate({
        where: { paymentStatus: 'PAID', paidAt: { gte: start, lt: end } },
        _sum: { amountVnd: true, platformFeeVnd: true },
        _count: { id: true },
      }),
      this.prisma.userUnlock.count({
        where: { unlockedAt: { gte: start, lt: end } },
      }),
    ]);

    return {
      newUsers,
      gmvVnd: (paid._sum.amountVnd ?? 0n).toString(),
      unlockCount,
      platformRevenueVnd: (paid._sum.platformFeeVnd ?? 0n).toString(),
      paidOrders: paid._count.id,
    };
  }

  private async trends(start: Date, end: Date, dayCount: number) {
    const [orderRows, userRows, unlockRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ day: Date; gmv: bigint; orders: bigint }>>`
        SELECT date_trunc('day', "paidAt") AS day,
               COALESCE(SUM("amountVnd"), 0)::bigint AS gmv,
               COUNT(*)::bigint AS orders
          FROM orders
         WHERE "paymentStatus" = 'PAID'
           AND "paidAt" >= ${start}
           AND "paidAt" < ${end}
         GROUP BY day
         ORDER BY day ASC
      `,
      this.prisma.$queryRaw<Array<{ day: Date; cnt: bigint }>>`
        SELECT date_trunc('day', "createdAt") AS day,
               COUNT(*)::bigint AS cnt
          FROM users
         WHERE "createdAt" >= ${start}
           AND "createdAt" < ${end}
         GROUP BY day
         ORDER BY day ASC
      `,
      this.prisma.$queryRaw<Array<{ day: Date; cnt: bigint }>>`
        SELECT date_trunc('day', "unlockedAt") AS day,
               COUNT(*)::bigint AS cnt
          FROM user_unlocks
         WHERE "unlockedAt" >= ${start}
           AND "unlockedAt" < ${end}
         GROUP BY day
         ORDER BY day ASC
      `,
    ]);

    const gmvMap = new Map<string, { gmv: string; orders: number }>();
    for (const r of orderRows) {
      gmvMap.set(dayKey(r.day), { gmv: r.gmv.toString(), orders: Number(r.orders) });
    }
    const userMap = new Map<string, number>();
    for (const r of userRows) userMap.set(dayKey(r.day), Number(r.cnt));
    const unlockMap = new Map<string, number>();
    for (const r of unlockRows) unlockMap.set(dayKey(r.day), Number(r.cnt));

    const out: Array<{
      date: string;
      newUsers: number;
      gmvVnd: string;
      unlockCount: number;
      paidOrders: number;
    }> = [];

    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    for (let i = 0; i < dayCount; i++) {
      const k = dayKey(cursor);
      const o = gmvMap.get(k);
      out.push({
        date: k,
        newUsers: userMap.get(k) ?? 0,
        gmvVnd: o?.gmv ?? '0',
        unlockCount: unlockMap.get(k) ?? 0,
        paidOrders: o?.orders ?? 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  }

  private async todoCounts() {
    const [
      pendingDramas,
      pendingKyc,
      pendingWithdraws,
      overdueWithdraws,
      reconcileMismatch,
      transcodeFailed,
    ] = await Promise.all([
      this.prisma.drama.count({ where: { status: 'PENDING_REVIEW' } }),
      this.prisma.creator.count({ where: { kycStatus: 'PENDING' } }),
      this.prisma.withdrawRequest.count({ where: { status: 'PENDING' } }),
      this.prisma.withdrawRequest.count({
        where: {
          status: 'PENDING',
          createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
      this.prisma.paymentReconciliation.count({ where: { status: 'mismatch' } }),
      this.prisma.episode.count({ where: { transcodeStatus: 'FAILED' } }),
    ]);

    return {
      pendingDramas,
      pendingKyc,
      pendingWithdraws,
      overdueWithdraws,
      reconcileMismatch,
      transcodeFailed,
    };
  }

  private async rankings(start: Date, end: Date) {
    const dramaSelect = {
      id: true,
      titleEn: true,
      titleZh: true,
      slug: true,
      unlockCount: true,
      viewCount: true,
    } as const;

    const [topByView, topByUnlock, salesGrouped] = await Promise.all([
      this.prisma.drama.findMany({
        orderBy: { viewCount: 'desc' },
        take: 10,
        select: dramaSelect,
      }),
      this.prisma.drama.findMany({
        orderBy: { unlockCount: 'desc' },
        take: 10,
        select: dramaSelect,
      }),
      this.prisma.order.groupBy({
        by: ['dramaId'],
        where: {
          paymentStatus: 'PAID',
          orderType: { in: ['EPISODE_UNLOCK', 'DRAMA_BUYOUT'] },
          dramaId: { not: null },
          paidAt: { gte: start, lt: end },
        },
        _count: true,
        _sum: { amountCredits: true, amountVnd: true },
        orderBy: { _sum: { amountCredits: 'desc' } },
        take: 10,
      }),
    ]);

    const salesIds = salesGrouped.map((g) => g.dramaId!).filter(Boolean);
    const salesDramas = salesIds.length
      ? await this.prisma.drama.findMany({
          where: { id: { in: salesIds } },
          select: { id: true, titleEn: true, titleZh: true, slug: true },
        })
      : [];
    const salesMap = new Map(salesDramas.map((d) => [d.id.toString(), d]));

    const mapDrama = (d: (typeof topByView)[number]) => ({
      id: d.id.toString(),
      titleZh: d.titleZh,
      titleEn: d.titleEn,
      slug: d.slug,
      viewCount: Number(d.viewCount),
      unlockCount: Number(d.unlockCount),
    });

    return {
      topByView: topByView.map(mapDrama),
      topByUnlock: topByUnlock.map(mapDrama),
      topBySales: salesGrouped.map((g) => {
        const d = salesMap.get(g.dramaId!.toString());
        return {
          dramaId: g.dramaId!.toString(),
          titleZh: d?.titleZh ?? null,
          titleEn: d?.titleEn ?? null,
          slug: d?.slug ?? null,
          orderCount: g._count,
          credits: (g._sum.amountCredits ?? 0n).toString(),
          amountVnd: (g._sum.amountVnd ?? 0n).toString(),
        };
      }),
    };
  }

  private async bizBreakdown(start: Date, end: Date) {
    const wherePaid = {
      paymentStatus: 'PAID' as const,
      paidAt: { gte: start, lt: end },
    };

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
}

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function pctDelta(curr: number | bigint, prev: number | bigint): number | null {
  const c = typeof curr === 'bigint' ? Number(curr) : curr;
  const p = typeof prev === 'bigint' ? Number(prev) : prev;
  if (p === 0) return c === 0 ? 0 : null;
  return Math.round(((c - p) / p) * 1000) / 10;
}

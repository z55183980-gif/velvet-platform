import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BizCode, BizException } from '../common/biz.exception';
import { financeFreezePayload } from '../common/ledger-units';
import { PrismaService } from '../prisma/prisma.service';

export type DashboardRange = 'today' | '7d' | '30d' | 'custom';

/** Inclusive calendar-day span for custom ranges (from..to). */
const CUSTOM_MAX_DAYS = 90;

type KpiBlock = {
  newUsers: number;
  gmvVnd: string;
  unlockCount: number;
  platformRevenueVnd: string;
  paidOrders: number;
};

type WindowSpec = {
  range: DashboardRange;
  periodStart: Date;
  periodEnd: Date;
  prevStart: Date;
  prevEnd: Date;
  trendDays: number;
  from?: string;
  to?: string;
};

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** 主仪表盘：周期 KPI + 环比 + 趋势 + 待办 + 排行 + 经营拆分 */
  async overview(rangeInput?: string, fromInput?: string, toInput?: string) {
    const window = this.resolveWindow(rangeInput, fromInput, toInput);
    const { range, periodStart, periodEnd, prevStart, prevEnd, trendDays, from, to } = window;

    const trendStart = range === 'today' ? prevStart : periodStart;

    const [period, previous, trends, todos, rankings, bizBreakdown, dramaCount] =
      await Promise.all([
        this.kpi(periodStart, periodEnd),
        this.kpi(prevStart, prevEnd),
        this.trends(trendStart, periodEnd, trendDays),
        this.todoCounts(),
        this.rankings(periodStart, periodEnd),
        this.bizBreakdown(periodStart, periodEnd),
        this.prisma.drama.count(),
      ]);

    return {
      range,
      from: from ?? null,
      to: to ?? null,
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
      meta: { dramaCount, ...financeFreezePayload() },
    };
  }

  private resolveWindow(rangeInput?: string, fromInput?: string, toInput?: string): WindowSpec {
    const preset =
      rangeInput === 'today' || rangeInput === '7d' || rangeInput === '30d' ? rangeInput : null;

    if (preset) {
      return { range: preset, ...this.windowForPreset(preset) };
    }

    if (rangeInput === 'custom' || (fromInput?.trim() && toInput?.trim())) {
      return this.windowForCustom(fromInput, toInput);
    }

    return { range: '7d', ...this.windowForPreset('7d') };
  }

  /** 半开区间 [start, end)；趋势天数 = 当前窗口自然日数 */
  private windowForPreset(range: Exclude<DashboardRange, 'custom'>) {
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

  private windowForCustom(fromInput?: string, toInput?: string): WindowSpec {
    const from = parseDay(fromInput);
    const to = parseDay(toInput);
    if (!from || !to) {
      throw new BizException(BizCode.BAD_REQUEST, 'dashboard.customRangeRequired');
    }
    if (from.getTime() > to.getTime()) {
      throw new BizException(BizCode.BAD_REQUEST, 'dashboard.customRangeOrder');
    }

    const todayStart = startOfLocalDay(new Date());
    if (from.getTime() > todayStart.getTime()) {
      throw new BizException(BizCode.BAD_REQUEST, 'dashboard.customRangeFuture');
    }

    const toClamped = to.getTime() > todayStart.getTime() ? todayStart : to;
    const periodStart = from;
    const periodEnd = addDays(toClamped, 1); // exclusive end of inclusive `to`
    const trendDays = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86_400_000);
    if (trendDays < 1) {
      throw new BizException(BizCode.BAD_REQUEST, 'dashboard.customRangeOrder');
    }
    if (trendDays > CUSTOM_MAX_DAYS) {
      throw new BizException(BizCode.BAD_REQUEST, 'dashboard.customRangeMax');
    }

    const prevEnd = periodStart;
    const prevStart = addDays(periodStart, -trendDays);

    return {
      range: 'custom',
      periodStart,
      periodEnd,
      prevStart,
      prevEnd,
      trendDays,
      from: dayKey(periodStart),
      to: dayKey(toClamped),
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

  /**
   * 浏览/解锁/销售排行均按 [start, end) 时间窗统计。
   * 浏览：watch_history 在窗内有进度的 user×episode 次数（按剧聚合）。
   * 解锁：user_unlocks.unlockedAt 落在窗内的次数（经 episodes 归到剧）。
   */
  private async rankings(start: Date, end: Date) {
    const [viewRows, unlockRows, salesGrouped] = await Promise.all([
      this.prisma.$queryRaw<Array<{ drama_id: bigint; cnt: bigint }>>`
        SELECT "dramaId" AS drama_id, COUNT(*)::bigint AS cnt
          FROM watch_history
         WHERE "watchedAt" >= ${start}
           AND "watchedAt" < ${end}
         GROUP BY "dramaId"
         ORDER BY cnt DESC
         LIMIT 10
      `,
      this.prisma.$queryRaw<Array<{ drama_id: bigint; cnt: bigint }>>`
        SELECT e."dramaId" AS drama_id, COUNT(*)::bigint AS cnt
          FROM user_unlocks u
          INNER JOIN episodes e ON e.id = u."episodeId"
         WHERE u."unlockedAt" >= ${start}
           AND u."unlockedAt" < ${end}
         GROUP BY e."dramaId"
         ORDER BY cnt DESC
         LIMIT 10
      `,
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

    const viewIdSet = new Set(viewRows.map((r) => r.drama_id.toString()));
    const unlockIdSet = new Set(unlockRows.map((r) => r.drama_id.toString()));
    const salesIds = salesGrouped.map((g) => g.dramaId!).filter(Boolean);
    const allIds = [
      ...viewRows.map((r) => r.drama_id),
      ...unlockRows.map((r) => r.drama_id),
      ...salesIds,
    ];
    const uniqueIds = [...new Map(allIds.map((id) => [id.toString(), id])).values()];

    const dramas = uniqueIds.length
      ? await this.prisma.drama.findMany({
          where: { id: { in: uniqueIds } },
          select: { id: true, titleEn: true, titleZh: true, slug: true },
        })
      : [];
    const dramaMap = new Map(dramas.map((d) => [d.id.toString(), d]));

    // 排行行需要同时展示窗内浏览与解锁，互为补全计数
    const needUnlockSide = viewRows
      .map((r) => r.drama_id)
      .filter((id) => !unlockIdSet.has(id.toString()));
    const needViewSide = unlockRows
      .map((r) => r.drama_id)
      .filter((id) => !viewIdSet.has(id.toString()));

    const [unlockSide, viewSide] = await Promise.all([
      needUnlockSide.length
        ? this.prisma.$queryRaw<Array<{ drama_id: bigint; cnt: bigint }>>`
            SELECT e."dramaId" AS drama_id, COUNT(*)::bigint AS cnt
              FROM user_unlocks u
              INNER JOIN episodes e ON e.id = u."episodeId"
             WHERE u."unlockedAt" >= ${start}
               AND u."unlockedAt" < ${end}
               AND e."dramaId" IN (${Prisma.join(needUnlockSide)})
             GROUP BY e."dramaId"
          `
        : Promise.resolve([] as Array<{ drama_id: bigint; cnt: bigint }>),
      needViewSide.length
        ? this.prisma.$queryRaw<Array<{ drama_id: bigint; cnt: bigint }>>`
            SELECT "dramaId" AS drama_id, COUNT(*)::bigint AS cnt
              FROM watch_history
             WHERE "watchedAt" >= ${start}
               AND "watchedAt" < ${end}
               AND "dramaId" IN (${Prisma.join(needViewSide)})
             GROUP BY "dramaId"
          `
        : Promise.resolve([] as Array<{ drama_id: bigint; cnt: bigint }>),
    ]);

    const viewCountMap = new Map<string, number>();
    for (const r of viewRows) viewCountMap.set(r.drama_id.toString(), Number(r.cnt));
    for (const r of viewSide) viewCountMap.set(r.drama_id.toString(), Number(r.cnt));

    const unlockCountMap = new Map<string, number>();
    for (const r of unlockRows) unlockCountMap.set(r.drama_id.toString(), Number(r.cnt));
    for (const r of unlockSide) unlockCountMap.set(r.drama_id.toString(), Number(r.cnt));

    const mapRankRow = (dramaId: bigint) => {
      const id = dramaId.toString();
      const d = dramaMap.get(id);
      return {
        id,
        titleZh: d?.titleZh ?? null,
        titleEn: d?.titleEn ?? null,
        slug: d?.slug ?? null,
        viewCount: viewCountMap.get(id) ?? 0,
        unlockCount: unlockCountMap.get(id) ?? 0,
      };
    };

    return {
      topByView: viewRows.map((r) => mapRankRow(r.drama_id)),
      topByUnlock: unlockRows.map((r) => mapRankRow(r.drama_id)),
      topBySales: salesGrouped.map((g) => {
        const id = g.dramaId!.toString();
        const d = dramaMap.get(id);
        return {
          dramaId: id,
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

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** Parse YYYY-MM-DD as local calendar day start. */
function parseDay(raw?: string): Date | null {
  const s = raw?.trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  if (mo < 1 || mo > 12 || day < 1 || day > 31) return null;
  const d = new Date(y, mo - 1, day);
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== day) return null;
  return d;
}

function pctDelta(curr: number | bigint, prev: number | bigint): number | null {
  const c = typeof curr === 'bigint' ? Number(curr) : curr;
  const p = typeof prev === 'bigint' ? Number(prev) : prev;
  if (p === 0) return c === 0 ? 0 : null;
  return Math.round(((c - p) / p) * 1000) / 10;
}

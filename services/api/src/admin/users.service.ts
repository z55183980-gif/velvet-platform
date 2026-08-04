import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import { AuditService } from '../common/audit.service';
import { VipPlansService } from '../vip/vip-plans.service';

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(filter: {
    q?: string;
    status?: 'ACTIVE' | 'SUSPENDED' | 'BANNED' | 'ALL';
    locale?: 'vi' | 'zh';
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, Math.floor(filter.page ?? 1));
    const pageSize = Math.min(100, Math.max(5, Math.floor(filter.pageSize ?? 20)));
    const where: any = { deletedAt: null };
    if (filter.status && filter.status !== 'ALL') where.status = filter.status;
    if (filter.locale) where.locale = filter.locale;
    if (filter.q) {
      where.OR = [
        { email: { contains: filter.q, mode: 'insensitive' } },
        { phone: { contains: filter.q } },
        { nickname: { contains: filter.q, mode: 'insensitive' } },
        { uuid: { contains: filter.q, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          uuid: true,
          email: true,
          phone: true,
          nickname: true,
          avatarUrl: true,
          locale: true,
          status: true,
          createdAt: true,
          wallet: {
            select: { balanceCredits: true, totalRechargedCredits: true, totalSpentCredits: true },
          },
          sessions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { ipAddress: true, country: true, city: true, createdAt: true },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      rows: rows.map((row) => {
        const last = row.sessions[0];
        const { sessions: _sessions, ...rest } = row;
        return {
          ...rest,
          region: last
            ? {
                ipAddress: last.ipAddress,
                country: last.country,
                city: last.city,
                at: last.createdAt,
              }
            : null,
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  async detail(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: BigInt(id) },
      include: {
        wallet: true,
        creator: { include: { earnings: true } },
        sessions: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });
    if (!user) throw new BizException(BizCode.NOT_FOUND, 'Không tìm thấy người dùng');

    const [txs, orders, unlocks, favs, history, notifications] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where: { walletUserId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.order.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.userUnlock.findMany({
        where: { userId: user.id },
        orderBy: { unlockedAt: 'desc' },
        take: 20,
        include: { episode: { include: { drama: { select: { id: true, titleVi: true, titleZh: true, slug: true } } } } },
      }),
      this.prisma.favorite.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { drama: { select: { id: true, slug: true, titleVi: true, titleZh: true, coverUrl: true } } },
      }),
      this.prisma.watchHistory.findMany({
        where: { userId: user.id },
        orderBy: { watchedAt: 'desc' },
        take: 20,
      }),
      this.prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    return {
      user,
      transactions: txs,
      orders,
      unlocks,
      favorites: favs,
      history,
      notifications,
    };
  }

  async setStatus(id: string, status: 'ACTIVE' | 'SUSPENDED' | 'BANNED', reason: string, actorId?: bigint) {
    if (!reason || !reason.trim()) {
      throw new BizException(BizCode.BAD_REQUEST, 'Lý do là bắt buộc');
    }
    const user = await this.prisma.user.update({
      where: { id: BigInt(id) },
      data: { status: status as any },
    });
    await this.audit.write({
      actorId,
      action: 'user.status',
      targetType: 'user',
      targetId: id,
      payload: { status, reason },
    });
    if (status === 'SUSPENDED' || status === 'BANNED') {
      try {
        await this.prisma.notification.create({
          data: {
            userId: user.id,
            type: status === 'BANNED' ? 'user.banned' : 'user.suspended',
            titleVi: status === 'BANNED' ? 'Tài khoản đã bị cấm' : 'Tài khoản tạm khóa',
            titleZh: status === 'BANNED' ? '账号已被封禁' : '账号已被暂停',
            bodyVi: `Lý do: ${reason}`,
            bodyZh: `原因：${reason}`,
            payload: { reason } as any,
          },
        });
      } catch {
        /* ignore */
      }
    }
    return { id: user.id.toString(), status: user.status };
  }

  async forceLogout(id: string, actorId?: bigint) {
    const cnt = await this.prisma.session.deleteMany({ where: { userId: BigInt(id) } });
    await this.audit.write({
      actorId,
      action: 'user.forceLogout',
      targetType: 'user',
      targetId: id,
      payload: { cleared: cnt.count },
    });
    return { cleared: cnt.count };
  }

  async setVip(
    id: string,
    dto: { vipExpireAt?: string | null; extendDays?: number },
    actorId?: bigint,
  ) {
    const userId = BigInt(id);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BizException(BizCode.NOT_FOUND, 'Không tìm thấy người dùng');

    let vipExpireAt: Date | null = user.vipExpireAt;
    if (dto.extendDays != null) {
      const days = Math.floor(Number(dto.extendDays));
      if (!Number.isFinite(days) || days < 1) {
        throw new BizException(BizCode.BAD_REQUEST, 'extendDays không hợp lệ');
      }
      vipExpireAt = VipPlansService.computeExpireAt(user.vipExpireAt, days);
    } else if (dto.vipExpireAt === null || dto.vipExpireAt === '') {
      vipExpireAt = null;
    } else if (dto.vipExpireAt != null) {
      const d = new Date(dto.vipExpireAt);
      if (Number.isNaN(d.getTime())) {
        throw new BizException(BizCode.BAD_REQUEST, 'vipExpireAt không hợp lệ');
      }
      vipExpireAt = d;
    } else {
      throw new BizException(BizCode.BAD_REQUEST, 'Cần vipExpireAt hoặc extendDays');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { vipExpireAt },
    });
    await this.audit.write({
      actorId,
      action: 'user.vip',
      targetType: 'user',
      targetId: id,
      payload: { vipExpireAt: vipExpireAt?.toISOString() ?? null, extendDays: dto.extendDays },
    });
    return {
      id: updated.id.toString(),
      vipExpireAt: updated.vipExpireAt?.toISOString() ?? null,
      isVip: !!(updated.vipExpireAt && updated.vipExpireAt.getTime() > Date.now()),
    };
  }

  /** 用户概览：总量、登录、新增、付费用户、付费总额/消费、注册趋势、语言分布 */
  async statisticsOverview(input: { range?: string; startDate?: string; endDate?: string }) {
    const { periodStart, periodEnd, prevStart, prevEnd, trendDays } = this.resolveStatsWindow(input);
    const baseWhere = { deletedAt: null } as const;

    const [
      totalUsers,
      paidUserRows,
      paidOrderAgg,
      newUsers,
      newPreviousPeriod,
      activeLoginRows,
      walletAgg,
      trendRows,
      localeRows,
    ] = await Promise.all([
      this.prisma.user.count({ where: baseWhere }),
      // Paid user: any recharge/spend on wallet, VIP history, or a PAID order.
      this.prisma.$queryRaw<Array<{ cnt: bigint }>>`
        SELECT COUNT(DISTINCT u.id)::bigint AS cnt
          FROM users u
          LEFT JOIN wallets w ON w."userId" = u.id
         WHERE u."deletedAt" IS NULL
           AND (
             COALESCE(w."totalRechargedCredits", 0) > 0
             OR COALESCE(w."totalSpentCredits", 0) > 0
             OR u."vipExpireAt" IS NOT NULL
             OR EXISTS (
               SELECT 1 FROM orders o
                WHERE o."userId" = u.id AND o."paymentStatus" = 'PAID'
             )
           )
      `,
      // Lifetime cumulative payment: sum Order.amountVnd for successful PAID orders (all-time).
      this.prisma.order.aggregate({
        where: { paymentStatus: 'PAID' },
        _sum: { amountVnd: true },
      }),
      this.prisma.user.count({
        where: { ...baseWhere, createdAt: { gte: periodStart, lt: periodEnd } },
      }),
      this.prisma.user.count({
        where: { ...baseWhere, createdAt: { gte: prevStart, lt: prevEnd } },
      }),
      this.prisma.$queryRaw<Array<{ cnt: bigint }>>`
        SELECT COUNT(DISTINCT "userId")::bigint AS cnt
          FROM sessions
         WHERE "createdAt" >= ${periodStart}
           AND "createdAt" < ${periodEnd}
      `,
      this.prisma.wallet.aggregate({
        _sum: {
          totalSpentCredits: true,
          totalRechargedCredits: true,
        },
      }),
      this.prisma.$queryRaw<Array<{ day: Date; cnt: bigint }>>`
        SELECT date_trunc('day', "createdAt") AS day,
               COUNT(*)::bigint AS cnt
          FROM users
         WHERE "deletedAt" IS NULL
           AND "createdAt" >= ${periodStart}
           AND "createdAt" < ${periodEnd}
         GROUP BY day
         ORDER BY day ASC
      `,
      this.prisma.user.groupBy({
        by: ['locale'],
        where: baseWhere,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
    ]);

    const activeUsers = Number(activeLoginRows[0]?.cnt ?? 0n);
    const paidUsers = Number(paidUserRows[0]?.cnt ?? 0n);
    const userMap = new Map<string, number>();
    for (const r of trendRows) userMap.set(statsDayKey(r.day), Number(r.cnt));

    const registrationTrend: Array<{ date: string; count: number }> = [];
    const cursor = new Date(periodStart);
    cursor.setHours(0, 0, 0, 0);
    for (let i = 0; i < trendDays; i++) {
      const k = statsDayKey(cursor);
      registrationTrend.push({ date: k, count: userMap.get(k) ?? 0 });
      cursor.setDate(cursor.getDate() + 1);
    }

    const localeDistribution = localeRows.map((r) => ({
      locale: r.locale,
      count: r._count.id,
    }));

    return {
      range: input.range ?? (input.startDate && input.endDate ? 'custom' : '7d'),
      period: {
        start: statsDayKey(periodStart),
        end: statsDayKey(new Date(periodEnd.getTime() - 1)),
      },
      summary: {
        totalUsers,
        activeUsers,
        newUsers,
        newPreviousPeriod,
        paidUsers,
        totalPaidAmountVnd: (paidOrderAgg._sum.amountVnd ?? 0n).toString(),
        totalSpentCredits: (walletAgg._sum.totalSpentCredits ?? 0n).toString(),
        totalRechargedCredits: (walletAgg._sum.totalRechargedCredits ?? 0n).toString(),
        activeVipUsers: await this.prisma.user.count({
          where: { ...baseWhere, vipExpireAt: { gt: new Date() } },
        }),
      },
      registrationTrend,
      localeDistribution,
    };
  }

  private resolveStatsWindow(input: { range?: string; startDate?: string; endDate?: string }) {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    if (input.startDate && input.endDate) {
      const periodStart = parseStatsDate(input.startDate);
      const periodEnd = new Date(parseStatsDate(input.endDate));
      periodEnd.setDate(periodEnd.getDate() + 1);
      if (periodEnd <= periodStart) {
        throw new BizException(BizCode.BAD_REQUEST, '日期范围无效');
      }
      const days = Math.min(
        365,
        Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (24 * 60 * 60 * 1000)),
      );
      const prevEnd = new Date(periodStart);
      const prevStart = new Date(periodStart);
      prevStart.setDate(prevStart.getDate() - days);
      return { periodStart, periodEnd, prevStart, prevEnd, trendDays: days };
    }

    const range =
      input.range === 'today' || input.range === '7d' || input.range === '30d'
        ? input.range
        : '7d';

    if (range === 'today') {
      const prevStart = new Date(dayStart);
      prevStart.setDate(prevStart.getDate() - 1);
      return {
        periodStart: dayStart,
        periodEnd: dayEnd,
        prevStart,
        prevEnd: dayStart,
        trendDays: 1,
      };
    }

    const days = range === '7d' ? 7 : 30;
    const periodStart = new Date(dayStart);
    periodStart.setDate(periodStart.getDate() - (days - 1));
    const prevEnd = new Date(periodStart);
    const prevStart = new Date(periodStart);
    prevStart.setDate(prevStart.getDate() - days);

    return { periodStart, periodEnd: dayEnd, prevStart, prevEnd, trendDays: days };
  }
}

function statsDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseStatsDate(raw: string): Date {
  const d = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(d.getTime())) {
    throw new BizException(BizCode.BAD_REQUEST, '日期格式无效');
  }
  return d;
}

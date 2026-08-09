import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import { AdminUsersService } from './users.service';

@Injectable()
export class AdminCreatorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: AdminUsersService,
  ) {}

  async list(filter: { q?: string; kyc?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'; page?: number; pageSize?: number; sort?: 'available' | 'pending' | 'withdrawn' | 'total' }) {
    const page = Math.max(1, Math.floor(filter.page ?? 1));
    const pageSize = Math.min(100, Math.max(5, Math.floor(filter.pageSize ?? 20)));
    const where: any = {};
    if (filter.kyc && filter.kyc !== 'ALL') where.kycStatus = filter.kyc;
    if (filter.q) {
      where.OR = [
        { displayName: { contains: filter.q, mode: 'insensitive' } },
        { user: { email: { contains: filter.q, mode: 'insensitive' } } },
        { user: { phone: { contains: filter.q } } },
        { taxCode: { contains: filter.q } },
      ];
    }
    let orderBy: any = { id: 'desc' };
    // Prisma relation orderBy on optional 1:1 can be flaky; sort in memory after fetch when needed
    const [rawRows, total] = await Promise.all([
      this.prisma.creator.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { id: true, email: true, phone: true, nickname: true, status: true } },
          earnings: true,
          _count: { select: { dramas: true } },
        },
      }),
      this.prisma.creator.count({ where }),
    ]);
    let rows = rawRows;
    if (filter.sort === 'available') {
      rows = [...rawRows].sort(
        (a, b) => Number((b.earnings?.availableVnd ?? 0n) - (a.earnings?.availableVnd ?? 0n)),
      );
    } else if (filter.sort === 'pending') {
      rows = [...rawRows].sort(
        (a, b) => Number((b.earnings?.pendingVnd ?? 0n) - (a.earnings?.pendingVnd ?? 0n)),
      );
    } else if (filter.sort === 'withdrawn') {
      rows = [...rawRows].sort(
        (a, b) => Number((b.earnings?.withdrawnVnd ?? 0n) - (a.earnings?.withdrawnVnd ?? 0n)),
      );
    } else if (filter.sort === 'total') {
      rows = [...rawRows].sort(
        (a, b) => Number((b.earnings?.totalEarnedVnd ?? 0n) - (a.earnings?.totalEarnedVnd ?? 0n)),
      );
    }
    return { rows, total, page, pageSize };
  }

  /**
   * Close a creator account by banning the linked user (blocks login, clears sessions).
   * Reuses AdminUsersService.setStatus for consistent audit / notification behavior.
   */
  async closeAccount(id: string, actorId?: bigint) {
    const creator = await this.prisma.creator.findUnique({
      where: { id: BigInt(id) },
      select: {
        id: true,
        userId: true,
        displayName: true,
        user: { select: { id: true, status: true } },
      },
    });
    if (!creator) throw new BizException(BizCode.NOT_FOUND, 'creator.notFound');
    if (!creator.user) throw new BizException(BizCode.NOT_FOUND, 'user.notFound');
    if (creator.user.status === 'BANNED') {
      return {
        id: creator.id.toString(),
        userId: creator.userId.toString(),
        status: 'BANNED' as const,
        alreadyClosed: true,
      };
    }
    const result = await this.users.setStatus(
      creator.userId.toString(),
      'BANNED',
      '关闭账号',
      actorId,
    );
    return {
      id: creator.id.toString(),
      userId: result.id,
      status: result.status,
      alreadyClosed: false,
    };
  }

  async detail(id: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { id: BigInt(id) },
      include: {
        user: { select: { id: true, email: true, phone: true, nickname: true, locale: true, status: true, createdAt: true } },
        earnings: true,
        dramas: {
          orderBy: { createdAt: 'desc' },
          include: { _count: { select: { episodes: true } } },
        },
      },
    });
    if (!creator) throw new BizException(BizCode.NOT_FOUND, 'creator.notFound');
    const [paidAgg, monthlyAgg, perDrama] = await Promise.all([
      this.prisma.order.aggregate({
        where: { creatorId: creator.id, paymentStatus: 'PAID' },
        _sum: { creatorIncomeVnd: true, amountVnd: true },
        _count: { id: true },
      }),
      this.prisma.order.aggregate({
        where: {
          creatorId: creator.id,
          paymentStatus: 'PAID',
          paidAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
        _sum: { creatorIncomeVnd: true },
        _count: { id: true },
      }),
      this.prisma.order.groupBy({
        by: ['dramaId'],
        where: { creatorId: creator.id, paymentStatus: 'PAID' },
        _sum: { creatorIncomeVnd: true, amountVnd: true },
        _count: { id: true },
      }),
    ]);
    const dramaIds = perDrama.map((p) => p.dramaId).filter((x): x is bigint => x != null);
    const dramaMap = new Map(
      (await this.prisma.drama.findMany({
        where: { id: { in: dramaIds } },
        select: { id: true, titleEn: true, titleZh: true, slug: true },
      })).map((d) => [d.id.toString(), d] as const),
    );
    const breakdown = perDrama
      .map((p) => ({
        drama: dramaMap.get(p.dramaId!.toString()) || null,
        incomeVnd: (p._sum.creatorIncomeVnd ?? 0n).toString(),
        amountVnd: (p._sum.amountVnd ?? 0n).toString(),
        orders: p._count.id,
      }))
      .sort((a, b) => Number(BigInt(b.incomeVnd) - BigInt(a.incomeVnd)));
    return {
      creator,
      summary: {
        paidOrders: paidAgg._count.id,
        incomeTotal: (paidAgg._sum.creatorIncomeVnd ?? 0n).toString(),
        gmvTotal: (paidAgg._sum.amountVnd ?? 0n).toString(),
        monthIncome: (monthlyAgg._sum.creatorIncomeVnd ?? 0n).toString(),
        monthOrders: monthlyAgg._count.id,
      },
      perDrama: breakdown,
    };
  }
}

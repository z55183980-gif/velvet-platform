import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';

@Injectable()
export class AdminCreatorsService {
  constructor(private readonly prisma: PrismaService) {}

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
          user: { select: { id: true, email: true, phone: true, nickname: true } },
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
    if (!creator) throw new BizException(BizCode.NOT_FOUND, 'Không tìm thấy creator');
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
        select: { id: true, titleVi: true, titleZh: true, slug: true },
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

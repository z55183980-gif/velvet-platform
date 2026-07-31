import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filter: {
    type?: 'TOPUP' | 'EPISODE_UNLOCK' | 'ALL';
    status?: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'CANCELLED' | 'ALL';
    method?: string;
    userId?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, Math.floor(filter.page ?? 1));
    const pageSize = Math.min(100, Math.max(5, Math.floor(filter.pageSize ?? 20)));
    const where: any = {};
    if (filter.type && filter.type !== 'ALL') where.orderType = filter.type;
    if (filter.status && filter.status !== 'ALL') where.paymentStatus = filter.status;
    if (filter.method && filter.method !== 'ALL') where.paymentMethod = filter.method;
    if (filter.userId) where.userId = BigInt(filter.userId);
    if (filter.from || filter.to) {
      where.createdAt = {};
      if (filter.from) (where.createdAt as any).gte = new Date(filter.from);
      if (filter.to) (where.createdAt as any).lte = new Date(filter.to);
    }
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { id: true, email: true, phone: true, nickname: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    return { rows, total, page, pageSize };
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminWithdrawsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filter: { status?: 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED' | 'CANCELLED' | 'ALL'; page?: number; pageSize?: number }) {
    const page = Math.max(1, Math.floor(filter.page ?? 1));
    const pageSize = Math.min(100, Math.max(5, Math.floor(filter.pageSize ?? 20)));
    const where: any = {};
    if (filter.status && filter.status !== 'ALL') where.status = filter.status;
    const [rows, total] = await Promise.all([
      this.prisma.withdrawRequest.findMany({
        where,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          creator: {
            select: {
              id: true,
              displayName: true,
              taxCode: true,
              kycStatus: true,
              user: { select: { id: true, email: true, phone: true } },
            },
          },
        },
      }),
      this.prisma.withdrawRequest.count({ where }),
    ]);
    return { rows, total, page, pageSize };
  }
}

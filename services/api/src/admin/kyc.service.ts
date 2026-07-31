import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class KycService {
  constructor(private readonly prisma: PrismaService) {}

  /** 列出 KYC 待审/全部，带文档图片和用户信息 */
  async list(filter: { status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'; page?: number; pageSize?: number }) {
    const page = Math.max(1, Math.floor(filter.page ?? 1));
    const pageSize = Math.min(100, Math.max(5, Math.floor(filter.pageSize ?? 20)));
    const where: any = {};
    if (filter.status && filter.status !== 'ALL') where.kycStatus = filter.status;
    const [rows, total] = await Promise.all([
      this.prisma.creator.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              phone: true,
              nickname: true,
              avatarUrl: true,
              createdAt: true,
            },
          },
        },
      }),
      this.prisma.creator.count({ where }),
    ]);
    return { rows, total, page, pageSize };
  }
}

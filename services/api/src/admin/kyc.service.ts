import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { resignMediaUrl } from '../common/media-url.util';

@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

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
    // Re-sign docs/ URLs so admin UI can load CCCD after expiry / legacy unsigned paths.
    const mapped = rows.map((r) => ({
      ...r,
      cccdFrontUrl: resignMediaUrl(r.cccdFrontUrl, this.config, 2 * 3600) || r.cccdFrontUrl,
      cccdBackUrl: resignMediaUrl(r.cccdBackUrl, this.config, 2 * 3600) || r.cccdBackUrl,
    }));
    return { rows: mapped, total, page, pageSize };
  }
}

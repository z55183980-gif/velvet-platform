import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const ORDER_INCLUDE = {
  user: {
    select: {
      id: true,
      email: true,
      phone: true,
      nickname: true,
      vipExpireAt: true,
    },
  },
  package: {
    select: {
      id: true,
      name: true,
      credits: true,
      baseCredits: true,
      bonusCredits: true,
      baseCurrency: true,
      basePrice: true,
    },
  },
  vipPlan: {
    select: {
      id: true,
      name: true,
      nameEn: true,
      nameZh: true,
      durationDays: true,
      baseCurrency: true,
      basePrice: true,
    },
  },
} satisfies Prisma.OrderInclude;

type ListFilter = {
  type?: 'TOPUP' | 'EPISODE_UNLOCK' | 'VIP_SUB' | 'DRAMA_BUYOUT' | 'ALL';
  status?: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'CANCELLED' | 'ALL';
  method?: string;
  userId?: string;
  q?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};

@Injectable()
export class AdminOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filter: ListFilter) {
    const page = Math.max(1, Math.floor(filter.page ?? 1));
    const pageSize = Math.min(100, Math.max(5, Math.floor(filter.pageSize ?? 20)));
    const where = this.buildWhere(filter);

    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: ORDER_INCLUDE,
      }),
      this.prisma.order.count({ where }),
    ]);

    const enriched = await this.attachContentTitles(rows);
    return { rows: enriched, total, page, pageSize };
  }

  async detail(orderNo: string) {
    const row = await this.prisma.order.findUnique({
      where: { orderNo },
      include: ORDER_INCLUDE,
    });
    if (!row) throw new NotFoundException('ORDER_NOT_FOUND');

    const [enriched] = await this.attachContentTitles([row]);
    return enriched;
  }

  private buildWhere(filter: ListFilter): Prisma.OrderWhereInput {
    const where: Prisma.OrderWhereInput = {};
    if (filter.type && filter.type !== 'ALL') where.orderType = filter.type;
    if (filter.status && filter.status !== 'ALL') where.paymentStatus = filter.status;
    if (filter.method && filter.method !== 'ALL') {
      where.paymentMethod = filter.method as any;
    }
    if (filter.userId) where.userId = BigInt(filter.userId);
    if (filter.from || filter.to) {
      where.createdAt = {};
      if (filter.from) where.createdAt.gte = new Date(filter.from);
      if (filter.to) {
        const end = new Date(filter.to);
        if (!filter.to.includes('T')) end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    const q = filter.q?.trim();
    if (q) {
      const or: Prisma.OrderWhereInput[] = [
        { orderNo: { contains: q, mode: 'insensitive' } },
        { externalRef: { contains: q, mode: 'insensitive' } },
        {
          user: {
            OR: [
              { email: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q, mode: 'insensitive' } },
              { nickname: { contains: q, mode: 'insensitive' } },
            ],
          },
        },
      ];
      if (/^\d+$/.test(q)) {
        try {
          or.push({ userId: BigInt(q) });
        } catch {
          /* ignore oversized ids */
        }
      }
      where.OR = or;
    }

    return where;
  }

  private async attachContentTitles<
    T extends { dramaId: bigint | null; episodeId: bigint | null },
  >(rows: T[]) {
    const dramaIds = [...new Set(rows.map((r) => r.dramaId).filter((id): id is bigint => id != null))];
    const episodeIds = [
      ...new Set(rows.map((r) => r.episodeId).filter((id): id is bigint => id != null)),
    ];

    const [dramas, episodes] = await Promise.all([
      dramaIds.length
        ? this.prisma.drama.findMany({
            where: { id: { in: dramaIds } },
            select: { id: true, titleEn: true, titleZh: true, slug: true },
          })
        : Promise.resolve([]),
      episodeIds.length
        ? this.prisma.episode.findMany({
            where: { id: { in: episodeIds } },
            select: { id: true, episodeNumber: true, title: true, dramaId: true },
          })
        : Promise.resolve([]),
    ]);

    const dramaMap = new Map(dramas.map((d) => [String(d.id), d] as const));
    const episodeMap = new Map(episodes.map((e) => [String(e.id), e] as const));

    return rows.map((row) => ({
      ...row,
      drama: row.dramaId ? dramaMap.get(String(row.dramaId)) ?? null : null,
      episode: row.episodeId ? episodeMap.get(String(row.episodeId)) ?? null : null,
    }));
  }
}

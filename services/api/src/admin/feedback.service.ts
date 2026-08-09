import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BizCode, BizException } from '../common/biz.exception';
import { AuditService } from '../common/audit.service';

const STATUSES = new Set(['NEW', 'REVIEWING', 'CLOSED']);
const CATEGORIES = new Set(['feedback', 'complaint', 'suggestion']);

@Injectable()
export class AdminFeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(filter: {
    status?: string;
    category?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, Math.floor(filter.page ?? 1));
    const pageSize = Math.min(100, Math.max(5, Math.floor(filter.pageSize ?? 20)));
    const where: Record<string, unknown> = {};
    if (filter.status && filter.status !== 'ALL' && STATUSES.has(filter.status)) {
      where.status = filter.status;
    }
    if (filter.category && CATEGORIES.has(filter.category)) {
      where.category = filter.category;
    }

    const [rows, total] = await Promise.all([
      this.prisma.feedbackSubmission.findMany({
        where,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { id: true, email: true, phone: true, nickname: true } },
        },
      }),
      this.prisma.feedbackSubmission.count({ where }),
    ]);

    return {
      rows: rows.map((r) => ({
        id: r.id.toString(),
        userId: r.userId?.toString() ?? null,
        category: r.category,
        contactEmail: r.contactEmail,
        body: r.body,
        locale: r.locale,
        status: r.status,
        ipAddress: r.ipAddress,
        createdAt: r.createdAt.toISOString(),
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
        user: r.user
          ? {
              id: r.user.id.toString(),
              email: r.user.email,
              phone: r.user.phone,
              nickname: r.user.nickname,
            }
          : null,
      })),
      total,
      page,
      pageSize,
    };
  }

  async setStatus(id: string, status: string, actorId?: bigint) {
    if (!/^\d+$/.test(id)) {
      throw new BizException(BizCode.BAD_REQUEST, 'common.invalidData');
    }
    if (!STATUSES.has(status)) {
      throw new BizException(BizCode.BAD_REQUEST, 'common.invalidData');
    }

    const row = await this.prisma.feedbackSubmission.findUnique({ where: { id: BigInt(id) } });
    if (!row) throw new BizException(BizCode.NOT_FOUND, 'common.recordNotFound');

    const reviewedAt = status === 'NEW' ? null : new Date();
    const updated = await this.prisma.feedbackSubmission.update({
      where: { id: row.id },
      data: { status, reviewedAt },
      select: { id: true, status: true, reviewedAt: true },
    });

    await this.audit.write({
      actorId,
      action: 'feedback.status',
      targetType: 'feedback',
      targetId: id,
      payload: { from: row.status, to: status },
    });

    return {
      id: updated.id.toString(),
      status: updated.status,
      reviewedAt: updated.reviewedAt?.toISOString() ?? null,
    };
  }
}

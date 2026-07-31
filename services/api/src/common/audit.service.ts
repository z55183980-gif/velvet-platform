import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type AuditActorType = 'admin' | 'system' | 'creator' | 'user';

export interface AuditWriteInput {
  actorId?: bigint | number | null | undefined;
  actorType?: AuditActorType;
  action: string;
  targetType?: string;
  targetId?: string | number | bigint | null | undefined;
  payload?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  result?: 'ok' | 'fail';
  message?: string | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** 写一条审计日志（异常时降级为 warn，不影响业务） */
  async write(input: AuditWriteInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: input.actorId == null ? null : BigInt(input.actorId as any),
          actorType: input.actorType ?? 'admin',
          action: input.action,
          targetType: input.targetType ?? null,
          targetId:
            input.targetId == null
              ? null
              : typeof input.targetId === 'string'
                ? input.targetId
                : String(input.targetId),
          payload: (input.payload as any) ?? undefined,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
          result: input.result ?? 'ok',
          message: input.message ?? null,
        },
      });
    } catch (e) {
      // 不让审计失败阻塞业务；生产可对接 ELK
      // eslint-disable-next-line no-console
      console.warn('[audit] write failed', (e as any)?.message || e);
    }
  }

  async list(opts: {
    page?: number;
    pageSize?: number;
    actorId?: bigint;
    action?: string;
    targetType?: string;
    from?: Date;
    to?: Date;
  }) {
    const page = Math.max(1, Math.floor(opts.page ?? 1));
    const pageSize = Math.min(200, Math.max(5, Math.floor(opts.pageSize ?? 30)));
    const where: any = {};
    if (opts.actorId != null) where.actorId = opts.actorId;
    if (opts.action) where.action = opts.action;
    if (opts.targetType) where.targetType = opts.targetType;
    if (opts.from || opts.to) {
      where.createdAt = {};
      if (opts.from) (where.createdAt as any).gte = opts.from;
      if (opts.to) (where.createdAt as any).lte = opts.to;
    }
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { rows, total, page, pageSize };
  }
}
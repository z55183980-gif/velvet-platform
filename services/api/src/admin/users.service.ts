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
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { rows, total, page, pageSize };
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
}

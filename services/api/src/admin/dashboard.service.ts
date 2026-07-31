import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** 主仪表盘：今日/7 日 KPI + 待办计数 */
  async overview() {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const sevenStart = new Date(dayStart);
    sevenStart.setDate(sevenStart.getDate() - 6);

    const [
      userToday,
      user7d,
      paidToday,
      paid7d,
      unlocksToday,
      unlocks7d,
      pendingDramas,
      pendingKyc,
      pendingWithdraws,
      overdueWithdraws,
      reconcileMismatch,
      transcodeFailed,
      platformFee7d,
    ] = await Promise.all([
      this.prisma.user.count({ where: { createdAt: { gte: dayStart, lt: dayEnd } } }),
      this.prisma.user.count({ where: { createdAt: { gte: sevenStart, lt: dayEnd } } }),
      this.prisma.order.aggregate({
        where: { paymentStatus: 'PAID', paidAt: { gte: dayStart, lt: dayEnd } },
        _sum: { amountVnd: true, platformFeeVnd: true },
        _count: { id: true },
      }),
      this.prisma.order.aggregate({
        where: { paymentStatus: 'PAID', paidAt: { gte: sevenStart, lt: dayEnd } },
        _sum: { amountVnd: true, platformFeeVnd: true },
        _count: { id: true },
      }),
      this.prisma.userUnlock.count({
        where: { unlockedAt: { gte: dayStart, lt: dayEnd } },
      }),
      this.prisma.userUnlock.count({
        where: { unlockedAt: { gte: sevenStart, lt: dayEnd } },
      }),
      this.prisma.drama.count({ where: { status: 'PENDING_REVIEW' } }),
      this.prisma.creator.count({ where: { kycStatus: 'PENDING' } }),
      this.prisma.withdrawRequest.count({ where: { status: 'PENDING' } }),
      this.prisma.withdrawRequest.count({
        where: {
          status: 'PENDING',
          createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
      this.prisma.paymentReconciliation.count({ where: { status: 'mismatch' } }),
      this.prisma.episode.count({ where: { transcodeStatus: 'FAILED' } }),
      this.prisma.order.aggregate({
        where: { paymentStatus: 'PAID', paidAt: { gte: sevenStart, lt: dayEnd } },
        _sum: { platformFeeVnd: true },
      }),
    ]);

    return {
      today: {
        newUsers: userToday,
        gmvVnd: (paidToday._sum.amountVnd ?? 0n).toString(),
        unlockCount: unlocksToday,
        platformRevenueVnd: (paidToday._sum.platformFeeVnd ?? 0n).toString(),
        paidOrders: paidToday._count.id,
      },
      last7d: {
        newUsers: user7d,
        gmvVnd: (paid7d._sum.amountVnd ?? 0n).toString(),
        unlockCount: unlocks7d,
        platformRevenueVnd: (paid7d._sum.platformFeeVnd ?? 0n).toString(),
        paidOrders: paid7d._count.id,
      },
      todos: {
        pendingDramas,
        pendingKyc,
        pendingWithdraws,
        overdueWithdraws,
        reconcileMismatch,
        transcodeFailed,
      },
      platformFee7d: (platformFee7d._sum.platformFeeVnd ?? 0n).toString(),
    };
  }
}

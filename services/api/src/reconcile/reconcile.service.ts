import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

const PROVIDERS = ['STRIPE', 'WECHAT', 'ALIPAY', 'MOMO', 'ZALOPAY', 'VIETQR', 'BANK_TRANSFER'];
const T7_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class ReconcileService {
  private readonly logger = new Logger(ReconcileService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 每日 02:00 对账（MVP：本地口径；生产替换为拉取各渠道对账单 T+1 比对） */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async dailyReconcile() {
    const today = new Date();
    const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    this.logger.log(`[reconcile] start ${dayStart.toISOString().slice(0, 10)}`);
    for (const provider of PROVIDERS) {
      await this.reconcileProvider(provider, dayStart);
    }
  }

  /** 每小时：过期 Banner 自动 isActive=false（列表查询亦按 start/end 过滤） */
  @Cron(CronExpression.EVERY_HOUR)
  async deactivateExpiredBanners() {
    const now = new Date();
    const res = await this.prisma.banner.updateMany({
      where: { isActive: true, endAt: { lt: now } },
      data: { isActive: false },
    });
    if (res.count > 0) {
      this.logger.log(`[banner] deactivated ${res.count} expired banners`);
    }
  }

  /** 每小时：T+7 将 pendingVnd → availableVnd */
  @Cron(CronExpression.EVERY_HOUR)
  async settleT7Earnings() {
    const cutoff = new Date(Date.now() - T7_MS);
    const orders = await this.prisma.order.findMany({
      where: {
        orderType: 'EPISODE_UNLOCK',
        paymentStatus: 'PAID',
        earningSettled: false,
        creatorId: { not: null },
        paidAt: { lte: cutoff },
        creatorIncomeVnd: { gt: 0 },
      },
      take: 200,
      orderBy: { paidAt: 'asc' },
    });
    if (orders.length === 0) return;
    this.logger.log(`[settle-t7] processing ${orders.length} orders`);

    for (const order of orders) {
      if (!order.creatorId || !order.paidAt) continue;
      try {
        await this.prisma.$transaction(async (tx) => {
          const locked = await tx.order.findUnique({ where: { id: order.id } });
          if (!locked || locked.earningSettled || locked.paymentStatus !== 'PAID') return;
          await tx.creatorEarning.update({
            where: { creatorId: locked.creatorId! },
            data: {
              pendingVnd: { decrement: locked.creatorIncomeVnd },
              availableVnd: { increment: locked.creatorIncomeVnd },
            },
          });
          await tx.order.update({
            where: { id: locked.id },
            data: { earningSettled: true },
          });
        });
      } catch (e: any) {
        this.logger.warn(`[settle-t7] order ${order.orderNo} failed: ${e?.message || e}`);
      }
    }
  }

  /** 手动触发 T+7（开发/运维；可传 days 覆盖冷却天数，默认 7） */
  async settleNow(days = 7) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const before = await this.prisma.order.count({
      where: {
        orderType: 'EPISODE_UNLOCK',
        paymentStatus: 'PAID',
        earningSettled: false,
        paidAt: { lte: cutoff },
      },
    });
    // 临时改 cutoff：复用逻辑时直接 inline
    const orders = await this.prisma.order.findMany({
      where: {
        orderType: 'EPISODE_UNLOCK',
        paymentStatus: 'PAID',
        earningSettled: false,
        creatorId: { not: null },
        paidAt: { lte: cutoff },
        creatorIncomeVnd: { gt: 0 },
      },
      take: 500,
    });
    let settled = 0;
    for (const order of orders) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const locked = await tx.order.findUnique({ where: { id: order.id } });
          if (!locked || locked.earningSettled) return;
          await tx.creatorEarning.update({
            where: { creatorId: locked.creatorId! },
            data: {
              pendingVnd: { decrement: locked.creatorIncomeVnd },
              availableVnd: { increment: locked.creatorIncomeVnd },
            },
          });
          await tx.order.update({ where: { id: locked.id }, data: { earningSettled: true } });
          settled++;
        });
      } catch {
        /* skip */
      }
    }
    return { eligible: before, settled, days };
  }

  async reconcileProvider(provider: string, date: Date) {
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const localPaidCnt = await this.prisma.order.count({
      where: {
        paymentStatus: 'PAID',
        paymentMethod: provider as any,
        paidAt: { gte: dayStart, lt: dayEnd },
      },
    });

    // 开发态：无真实渠道对账单，remote 记为本地口径；生产在此拉取渠道 T+1 文件比对
    const remotePaidCnt = localPaidCnt;
    const status = localPaidCnt === remotePaidCnt ? 'matched' : 'mismatch';

    await this.prisma.paymentReconciliation.upsert({
      where: { date_provider: { date: dayStart, provider } },
      create: {
        date: dayStart,
        provider,
        localPaidCnt,
        remotePaidCnt,
        status,
        diffJson: { note: 'dev-mock-remote' },
      },
      update: { localPaidCnt, remotePaidCnt, status, diffJson: { note: 'dev-mock-remote' } },
    });
    return { provider, localPaidCnt, remotePaidCnt, status };
  }
}

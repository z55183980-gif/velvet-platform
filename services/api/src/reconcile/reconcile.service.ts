import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { fetchStripePaidCountsForDay } from '../payments/stripe-reconcile';

const PROVIDERS = ['STRIPE', 'WECHAT', 'ALIPAY', 'MOMO', 'ZALOPAY', 'VIETQR', 'BANK_TRANSFER'];
const T7_MS = 7 * 24 * 60 * 60 * 1000;

function productionMode(): boolean {
  const env = (
    process.env.ENVIRONMENT ||
    process.env.APP_ENV ||
    process.env.NODE_ENV ||
    ''
  )
    .trim()
    .toLowerCase();
  return env === 'production' || env === 'prod' || env === 'live';
}

@Injectable()
export class ReconcileService {
  private readonly logger = new Logger(ReconcileService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 每日 02:00 对账 */
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
    await this.settleEligible(cutoff, 200);
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
    const settled = await this.settleEligible(cutoff, 500);
    return { eligible: before, settled, days };
  }

  /**
   * Claim-first settle: updateMany(earningSettled:false→true) then move balances.
   * Safe under concurrent API+manual triggers (no FOR UPDATE required).
   */
  private async settleEligible(cutoff: Date, take: number): Promise<number> {
    const orders = await this.prisma.order.findMany({
      where: {
        orderType: 'EPISODE_UNLOCK',
        paymentStatus: 'PAID',
        earningSettled: false,
        creatorId: { not: null },
        paidAt: { lte: cutoff },
        creatorIncomeVnd: { gt: 0 },
      },
      take,
      orderBy: { paidAt: 'asc' },
    });
    if (orders.length === 0) return 0;
    this.logger.log(`[settle-t7] processing ${orders.length} orders`);

    let settled = 0;
    for (const order of orders) {
      if (!order.creatorId || !order.paidAt) continue;
      try {
        await this.prisma.$transaction(async (tx) => {
          const claimed = await tx.order.updateMany({
            where: {
              id: order.id,
              earningSettled: false,
              paymentStatus: 'PAID',
            },
            data: { earningSettled: true },
          });
          if (claimed.count !== 1) return;

          await tx.creatorEarning.update({
            where: { creatorId: order.creatorId! },
            data: {
              pendingVnd: { decrement: order.creatorIncomeVnd },
              availableVnd: { increment: order.creatorIncomeVnd },
            },
          });
          settled++;
        });
      } catch (e: any) {
        this.logger.warn(`[settle-t7] order ${order.orderNo} failed: ${e?.message || e}`);
        // Best-effort rollback of claim if balance move failed
        try {
          await this.prisma.order.updateMany({
            where: { id: order.id, earningSettled: true, paymentStatus: 'PAID' },
            data: { earningSettled: false },
          });
        } catch {
          /* ignore */
        }
      }
    }
    return settled;
  }

  async reconcileProvider(provider: string, date: Date) {
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const localOrders = await this.prisma.order.findMany({
      where: {
        paymentStatus: 'PAID',
        paymentMethod: provider as any,
        paidAt: { gte: dayStart, lt: dayEnd },
      },
      select: {
        orderNo: true,
        payAmount: true,
        payCurrency: true,
      },
    });
    const localPaidCnt = localOrders.length;
    const localAmountByCurrency: Record<string, number> = {};
    for (const o of localOrders) {
      const cur = String(o.payCurrency || 'USD').toUpperCase();
      const amt = Number(o.payAmount || 0);
      localAmountByCurrency[cur] = (localAmountByCurrency[cur] || 0) + (Number.isFinite(amt) ? amt : 0);
    }

    let remotePaidCnt = 0;
    let status: string;
    let diffJson: Record<string, unknown>;

    if (provider === 'STRIPE') {
      try {
        const remote = await fetchStripePaidCountsForDay(dayStart, dayEnd);
        remotePaidCnt = remote.paidCnt;
        const countMatch = localPaidCnt === remotePaidCnt;
        const currencyNotes: string[] = [];
        let amountMatch = true;
        for (const [cur, localAmt] of Object.entries(localAmountByCurrency)) {
          const remoteAmt = remote.amountMajorByCurrency[cur] ?? 0;
          // Allow 0.5 major-unit tolerance for float snapshots
          if (Math.abs(localAmt - remoteAmt) > 0.5) {
            amountMatch = false;
            currencyNotes.push(`${cur}: local=${localAmt} remote=${remoteAmt}`);
          }
        }
        for (const [cur, remoteAmt] of Object.entries(remote.amountMajorByCurrency)) {
          if (!(cur in localAmountByCurrency) && remoteAmt > 0.5) {
            amountMatch = false;
            currencyNotes.push(`${cur}: local=0 remote=${remoteAmt}`);
          }
        }
        status = countMatch && amountMatch ? 'matched' : 'mismatch';
        diffJson = {
          source: 'stripe-api',
          localPaidCnt,
          remotePaidCnt,
          localAmountByCurrency,
          remoteAmountMajorByCurrency: remote.amountMajorByCurrency,
          amountNotes: currencyNotes,
          stripeError: remote.error || null,
        };
        if (remote.error) {
          status = 'error';
          this.logger.warn(`[reconcile] STRIPE remote error: ${remote.error}`);
        }
      } catch (e: any) {
        remotePaidCnt = -1;
        status = 'error';
        diffJson = {
          source: 'stripe-api',
          localPaidCnt,
          error: e?.message || String(e),
        };
        this.logger.error(`[reconcile] STRIPE failed: ${e?.message || e}`);
      }
    } else if (productionMode()) {
      // Never fake matched in production for unwired channels
      remotePaidCnt = -1;
      status = 'unverified';
      diffJson = {
        note: 'provider-remote-not-wired',
        localPaidCnt,
        localAmountByCurrency,
      };
    } else {
      remotePaidCnt = localPaidCnt;
      status = 'matched';
      diffJson = { note: 'dev-mock-remote', localPaidCnt };
    }

    await this.prisma.paymentReconciliation.upsert({
      where: { date_provider: { date: dayStart, provider } },
      create: {
        date: dayStart,
        provider,
        localPaidCnt,
        remotePaidCnt: Math.max(0, remotePaidCnt),
        status,
        diffJson: diffJson as any,
      },
      update: {
        localPaidCnt,
        remotePaidCnt: Math.max(0, remotePaidCnt),
        status,
        diffJson: diffJson as any,
      },
    });
    return { provider, localPaidCnt, remotePaidCnt, status, diffJson };
  }
}

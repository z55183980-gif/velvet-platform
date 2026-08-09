import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import { toBigInt, genOrderNo, toDecimal } from '../common/money.util';
import { PackagesService } from '../packages/packages.service';
import { VipPlansService } from '../vip/vip-plans.service';
import { StructuredLogger } from '../common/structured-logger.service';
import { LockAccessService } from '../common/lock-access.service';
import { PlatformSettingsService } from '../common/platform-settings.service';
import { createStripeCheckoutSession } from '../payments/stripe-checkout';
import {
  isFinanceOpsFrozen,
  resolveUsdCentsPerCredit,
  splitWalletCreditsLedger,
  usdCentsToPayAmountMajor,
} from '../common/ledger-units';

const WALLET_RETRY = 3;
const PAY_CURRENCY = 'USD';

/** Ledger minor units: USD cents (amountVnd column retains legacy name). */
function usdToCents(payAmount: Prisma.Decimal): bigint {
  return BigInt(payAmount.mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toString());
}

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly packages: PackagesService,
    private readonly vipPlans: VipPlansService,
    private readonly log: StructuredLogger,
    private readonly lockAccess: LockAccessService,
    private readonly platformSettings: PlatformSettingsService,
  ) {}

  private async defaultRevenueShare() {
    return new Prisma.Decimal(await this.platformSettings.getRevenueShareDefault());
  }

  // ============ 查询 ============
  async getBalance(userId: bigint) {
    const w = await this.prisma.wallet.findUnique({ where: { userId } });
    return {
      balanceCredits: (w?.balanceCredits ?? 0n).toString(),
      totalRechargedCredits: (w?.totalRechargedCredits ?? 0n).toString(),
      totalSpentCredits: (w?.totalSpentCredits ?? 0n).toString(),
    };
  }

  async getTransactions(userId: bigint, page = 1, pageSize = 20) {
    const [rows, total] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where: { walletUserId: userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.walletTransaction.count({ where: { walletUserId: userId } }),
    ]);
    return { rows, total, page, pageSize };
  }

  async myOrders(userId: bigint, page = 1, pageSize = 20) {
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.order.count({ where: { userId } }),
    ]);
    return { rows, total, page, pageSize };
  }

  // ============ 充值下单（USD 标价；积分以套餐为准）============
  async createTopupOrder(
    dto: {
      packageId: number | string;
      currency?: string;
      paymentMethod?: string;
      createCheckout?: boolean;
      idempotencyKey?: string;
    },
    userId: bigint,
  ) {
    const currency = PAY_CURRENCY;
    const pkg = await this.packages.getActive(toBigInt(dto.packageId));
    const payAmount = new Prisma.Decimal(pkg.basePrice.toString()).toDecimalPlaces(
      2,
      Prisma.Decimal.ROUND_HALF_UP,
    );
    const credits = pkg.credits;
    if (credits <= 0n) throw new BizException(BizCode.BAD_REQUEST, 'Gói nạp không hợp lệ');

    const idem =
      dto.idempotencyKey ||
      `topup:${userId}:pkg${pkg.id}:${currency}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
    const existing = await this.prisma.order.findUnique({ where: { idempotencyKey: idem } });
    if (existing) return this.orderView(existing);

    const amountVnd = usdToCents(payAmount);
    const requested = String(dto.paymentMethod || 'STRIPE').toUpperCase();
    const method = (
      process.env.NODE_ENV === 'production' ? 'STRIPE' : requested || 'STRIPE'
    ) as any;
    if (method === 'ALIPAY') {
      throw new BizException(BizCode.BAD_REQUEST, 'Alipay is not supported for USD payments');
    }
    if (process.env.NODE_ENV === 'production' && requested && requested !== 'STRIPE') {
      throw new BizException(BizCode.BAD_REQUEST, 'Only STRIPE is supported');
    }

    await this.ensureWallet(userId);
    const order = await this.prisma.order.create({
      data: {
        orderNo: genOrderNo('TP'),
        idempotencyKey: idem,
        userId,
        orderType: 'TOPUP',
        packageId: pkg.id,
        amountVnd,
        amountCredits: credits,
        creatorIncomeVnd: 0n,
        platformFeeVnd: 0n,
        payCurrency: currency,
        payAmount,
        fxRate: new Prisma.Decimal(1),
        fxSource: 'usd',
        paymentMethod: method,
        paymentStatus: 'PENDING',
      },
    });

    const base: any = {
      ...this.orderView(order),
      credits: credits.toString(),
      packageId: pkg.id.toString(),
      packageName: pkg.name,
      basePriceUsd: pkg.basePrice.toString(),
    };

    if (process.env.NODE_ENV !== 'production') {
      base.devPayUrl = `/api/v1/payments/simulate?orderNo=${order.orderNo}`;
      base.simulate = true;
    }

    if (method === 'STRIPE' && dto.createCheckout !== false) {
      await this.attachStripeCheckout(base, {
        orderNo: order.orderNo,
        userId,
        productName: String(pkg.name || 'Velvet credits'),
        payAmountMajor: payAmount.toString(),
        currency,
        orderType: 'TOPUP',
      });
    }
    return base;
  }

  // ============ VIP 订阅下单（USD 标价，成功后延长 vipExpireAt）============
  async createVipSubOrder(
    dto: {
      vipPlanId: number | string;
      currency?: string;
      paymentMethod?: string;
      createCheckout?: boolean;
      idempotencyKey?: string;
    },
    userId: bigint,
  ) {
    const currency = PAY_CURRENCY;
    const plan = await this.vipPlans.getActive(toBigInt(dto.vipPlanId));
    const payAmount = new Prisma.Decimal(plan.basePrice.toString()).toDecimalPlaces(
      2,
      Prisma.Decimal.ROUND_HALF_UP,
    );

    const idem =
      dto.idempotencyKey ||
      `vip:${userId}:plan${plan.id}:${currency}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
    const existing = await this.prisma.order.findUnique({ where: { idempotencyKey: idem } });
    if (existing) return this.orderView(existing);

    const amountVnd = usdToCents(payAmount);
    const requested = String(dto.paymentMethod || 'STRIPE').toUpperCase();
    const method = (
      process.env.NODE_ENV === 'production' ? 'STRIPE' : requested || 'STRIPE'
    ) as any;
    if (method === 'ALIPAY') {
      throw new BizException(BizCode.BAD_REQUEST, 'Alipay is not supported for USD payments');
    }
    if (process.env.NODE_ENV === 'production' && requested && requested !== 'STRIPE') {
      throw new BizException(BizCode.BAD_REQUEST, 'Only STRIPE is supported');
    }

    const order = await this.prisma.order.create({
      data: {
        orderNo: genOrderNo('VP'),
        idempotencyKey: idem,
        userId,
        orderType: 'VIP_SUB',
        vipPlanId: plan.id,
        amountVnd,
        amountCredits: 0n,
        creatorIncomeVnd: 0n,
        platformFeeVnd: 0n,
        payCurrency: currency,
        payAmount,
        fxRate: new Prisma.Decimal(1),
        fxSource: 'usd',
        paymentMethod: method,
        paymentStatus: 'PENDING',
        meta: { durationDays: plan.durationDays, planName: plan.name } as any,
      },
    });

    const base: any = {
      ...this.orderView(order),
      vipPlanId: plan.id.toString(),
      planName: plan.name,
      durationDays: plan.durationDays,
      basePriceUsd: plan.basePrice.toString(),
    };

    if (process.env.NODE_ENV !== 'production') {
      base.devPayUrl = `/api/v1/payments/simulate?orderNo=${order.orderNo}`;
      base.simulate = true;
    }

    if (method === 'STRIPE' && dto.createCheckout !== false) {
      await this.attachStripeCheckout(base, {
        orderNo: order.orderNo,
        userId,
        productName: String(plan.name || `VIP ${plan.durationDays}d`),
        payAmountMajor: payAmount.toString(),
        currency,
        orderType: 'VIP_SUB',
      });
    }
    return base;
  }

  // ============ 整剧买断（扣积分）============
  async unlockDrama(dto: { dramaId: number | string; idempotencyKey?: string }, userId: bigint) {
    const dramaId = toBigInt(dto.dramaId);
    const idem = dto.idempotencyKey || `drama-buyout:${userId}:${dramaId}`;

    const existing = await this.prisma.userDramaUnlock.findUnique({
      where: { userId_dramaId: { userId, dramaId } },
    });
    if (existing) {
      return {
        unlocked: true,
        alreadyUnlocked: true,
        dramaId: dramaId.toString(),
        unlockId: existing.id.toString(),
        orderId: existing.orderId?.toString() ?? null,
      };
    }

    const drama = await this.prisma.drama.findUnique({ where: { id: dramaId } });
    if (!drama) throw new BizException(BizCode.NOT_FOUND, 'Phim không tồn tại');
    const buyout = drama.buyoutCredits ?? 0n;
    if (buyout <= 0n) {
      throw new BizException(BizCode.BAD_REQUEST, 'Phim này không hỗ trợ mua cả bộ');
    }

    await this.ensureWallet(userId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const again = await tx.userDramaUnlock.findUnique({
          where: { userId_dramaId: { userId, dramaId } },
        });
        if (again) {
          return {
            unlocked: true,
            alreadyUnlocked: true,
            dramaId: dramaId.toString(),
            unlockId: again.id.toString(),
            orderId: again.orderId?.toString() ?? null,
          };
        }

        let order = await tx.order.findUnique({ where: { idempotencyKey: idem } });
        if (!order) {
          const creator = await tx.creator.findUnique({ where: { id: drama.creatorId } });
          const share = creator?.revenueShare ?? (await this.defaultRevenueShare());
          const ledger = await this.splitCreditsToUsdLedger(buyout, share);
          order = await tx.order.create({
            data: {
              orderNo: genOrderNo('DB'),
              idempotencyKey: idem,
              userId,
              creatorId: drama.creatorId,
              orderType: 'DRAMA_BUYOUT',
              dramaId,
              // amountVnd* = USD cents (legacy column name); credits stay in amountCredits
              amountVnd: ledger.amountUsdCents,
              amountCredits: buyout,
              creatorIncomeVnd: ledger.creatorIncomeUsdCents,
              platformFeeVnd: ledger.platformFeeUsdCents,
              payCurrency: 'USD',
              payAmount: new Prisma.Decimal(usdCentsToPayAmountMajor(ledger.amountUsdCents)),
              fxRate: new Prisma.Decimal(String(ledger.usdCentsPerCredit)),
              fxSource: ledger.financeFrozen ? 'wallet-credits-frozen' : 'wallet-credits',
              paymentMethod: 'WALLET',
              paymentStatus: 'PENDING',
              meta: {
                revenueShare: share.toString(),
                ledgerCurrency: 'USD',
                ledgerMinorUnit: 'USD_CENTS',
                ledgerDirty: false,
                usdCentsPerCredit: ledger.usdCentsPerCredit,
                financeFrozen: ledger.financeFrozen,
                deferredCreatorIncomeUsdCents:
                  ledger.deferredCreatorIncomeUsdCents?.toString() ?? null,
                creatorAccrualSkipped: ledger.financeFrozen,
              } as any,
            },
          });
        }

        if (order.paymentStatus === 'PAID') {
          const unlock = await tx.userDramaUnlock.findUnique({
            where: { userId_dramaId: { userId, dramaId } },
          });
          return {
            unlocked: true,
            alreadyUnlocked: true,
            dramaId: dramaId.toString(),
            unlockId: unlock?.id.toString() ?? null,
            orderId: order.id.toString(),
          };
        }

        const okCharge = await this.chargeWalletTx(
          tx,
          userId,
          buyout,
          order.id,
          'UNLOCK',
          `Mua cả bộ #${dramaId}`,
        );
        if (!okCharge) {
          throw new BizException(BizCode.INSUFFICIENT_BALANCE, 'Số dư credits không đủ để mua cả bộ');
        }

        await tx.order.update({
          where: { id: order.id },
          data: { paymentStatus: 'PAID', paidAt: new Date() },
        });

        const unlock = await tx.userDramaUnlock.create({
          data: { userId, dramaId, orderId: order.id },
        });
        await tx.drama.update({
          where: { id: dramaId },
          data: { unlockCount: { increment: 1 } },
        });
        if (order.creatorIncomeVnd > 0n) {
          await this.creditCreator(tx, drama.creatorId, order.creatorIncomeVnd);
        }

        return {
          unlocked: true,
          alreadyUnlocked: false,
          dramaId: dramaId.toString(),
          unlockId: unlock.id.toString(),
          orderId: order.id.toString(),
          creditsSpent: buyout.toString(),
        };
      });
    } catch (e: any) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const unlock = await this.prisma.userDramaUnlock.findUnique({
          where: { userId_dramaId: { userId, dramaId } },
        });
        if (unlock) {
          return {
            unlocked: true,
            alreadyUnlocked: true,
            dramaId: dramaId.toString(),
            unlockId: unlock.id.toString(),
            orderId: unlock.orderId?.toString() ?? null,
          };
        }
      }
      throw e;
    }
  }

  // ============ 单集解锁（事务：扣积分 + PAID + 解锁 + 分账 + 幂等）============
  async unlockEpisode(dto: { episodeId: number | string; idempotencyKey?: string }, userId: bigint) {
    const episodeId = toBigInt(dto.episodeId);
    const idem = dto.idempotencyKey || `unlock:${userId}:${episodeId}`;

    const existing = await this.prisma.userUnlock.findUnique({
      where: { userId_episodeId: { userId, episodeId } },
    });
    // Paid unlocks (orderId set) are permanent. Soft rows (orderId null) from legacy
    // VIP/free grants must NOT short-circuit — they expire with VIP / policy changes.
    if (existing?.orderId != null) {
      return {
        unlocked: true,
        alreadyUnlocked: true,
        isFree: false,
        episodeId: episodeId.toString(),
        unlockId: existing.id.toString(),
        orderId: existing.orderId.toString(),
      };
    }
    if (existing && existing.orderId == null) {
      // Drop stale soft unlock so free→paid / VIP expiry cannot keep access forever.
      await this.prisma.userUnlock.deleteMany({
        where: { userId, episodeId, orderId: null },
      });
    }

    const episode = await this.prisma.episode.findUnique({
      where: { id: episodeId },
      include: { drama: true },
    });
    if (!episode) throw new BizException(BizCode.NOT_FOUND, 'episode.notFound');

    const isFree = this.lockAccess.isFree(
      episode,
      await this.lockAccess.resolveForDrama(episode.drama),
    );

    // VIP / buyout / free: ephemeral entitlements — do NOT persist UserUnlock(orderId=null).
    if (!isFree) {
      const [user, dramaUnlock] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: userId }, select: { vipExpireAt: true } }),
        this.prisma.userDramaUnlock.findUnique({
          where: { userId_dramaId: { userId, dramaId: episode.dramaId } },
        }),
      ]);
      const vipActive = !!(user?.vipExpireAt && user.vipExpireAt.getTime() > Date.now());
      if (vipActive || dramaUnlock) {
        return {
          unlocked: true,
          alreadyUnlocked: false,
          isFree: false,
          viaVip: vipActive,
          viaDramaBuyout: !!dramaUnlock,
          episodeId: episodeId.toString(),
          unlockId: null,
          orderId: dramaUnlock?.orderId?.toString() ?? null,
        };
      }
    }

    if (isFree) {
      return {
        unlocked: true,
        alreadyUnlocked: false,
        isFree: true,
        episodeId: episodeId.toString(),
        unlockId: null,
        orderId: null,
      };
    }

    await this.ensureWallet(userId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const again = await tx.userUnlock.findUnique({
          where: { userId_episodeId: { userId, episodeId } },
        });
        if (again) {
          return {
            unlocked: true,
            alreadyUnlocked: true,
            isFree: false,
            episodeId: episodeId.toString(),
            unlockId: again.id.toString(),
            orderId: again.orderId?.toString() ?? null,
          };
        }

        const order = await this.findOrCreateUnlockOrderTx(tx, userId, episode, idem);
        if (order.paymentStatus === 'PAID') {
          const unlock = await tx.userUnlock.findUnique({
            where: { userId_episodeId: { userId, episodeId } },
          });
          return {
            unlocked: true,
            alreadyUnlocked: true,
            isFree: false,
            episodeId: episodeId.toString(),
            unlockId: unlock?.id.toString() ?? null,
            orderId: order.id.toString(),
          };
        }

        const charged = await this.chargeWalletTx(
          tx,
          userId,
          episode.priceCredits,
          order.id,
          'UNLOCK',
          `Mở tập ${episode.episodeNumber}`,
        );
        if (!charged) throw new BizException(BizCode.INSUFFICIENT_BALANCE, 'Số dư không đủ để mở tập này');

        const paidAt = new Date();
        // Preserve create-time payAmount (USD major) / fx metadata — do not overwrite
        // with amountVnd (USD cents), which would inflate by 100x.
        await tx.order.update({
          where: { id: order.id },
          data: { paymentStatus: 'PAID', paidAt },
        });

        const unlockRec = await tx.userUnlock.create({
          data: { userId, episodeId, orderId: order.id },
        });
        await tx.episode.update({ where: { id: episodeId }, data: { unlockCount: { increment: 1 } } });
        await tx.drama.update({ where: { id: episode.dramaId }, data: { unlockCount: { increment: 1 } } });
        await this.creditCreator(tx, episode.drama.creatorId, order.creatorIncomeVnd);

        return {
          unlocked: true,
          alreadyUnlocked: false,
          isFree: false,
          episodeId: episodeId.toString(),
          unlockId: unlockRec.id.toString(),
          orderId: order.id.toString(),
        };
      });
    } catch (e: any) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const unlock = await this.prisma.userUnlock.findUnique({
          where: { userId_episodeId: { userId, episodeId } },
        });
        if (unlock) {
          return {
            unlocked: true,
            alreadyUnlocked: true,
            isFree: false,
            episodeId: episodeId.toString(),
            unlockId: unlock.id.toString(),
            orderId: unlock.orderId?.toString() ?? null,
          };
        }
      }
      throw e;
    }
  }

  // ============ 支付确认入账（webhook / mark-paid / simulate 统一入口，幂等）============
  async creditOnPaid(
    orderNo: string,
    opts?: { externalRef?: string; payAmount?: number | string; currency?: string },
  ) {
    const t0 = Date.now();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({ where: { orderNo } });
        if (!order) throw new BizException(BizCode.NOT_FOUND, 'order.notFound');
        if (order.paymentStatus === 'REFUNDED') {
          throw new BizException(
            BizCode.CONFLICT,
            'order.alreadyRefundedCannotMarkPaid',
          );
        }
        if (order.paymentStatus === 'PAID') {
          return { alreadyPaid: true, orderNo: order.orderNo, status: order.paymentStatus };
        }
        if (order.paymentStatus !== 'PENDING') {
          throw new BizException(
            BizCode.CONFLICT,
            `order.statusNotPayable:${order.paymentStatus}`,
          );
        }

        const claimed = await tx.order.updateMany({
          where: { id: order.id, paymentStatus: 'PENDING' },
          data: {
            paymentStatus: 'PAID',
            externalRef: opts?.externalRef,
            paidAt: new Date(),
            payCurrency: opts?.currency ?? order.payCurrency,
            payAmount: opts?.payAmount != null ? toDecimal(opts.payAmount as any) : undefined,
            fxSource: order.fxSource || 'webhook',
          },
        });
        if (claimed.count !== 1) {
          const again = await tx.order.findUnique({ where: { id: order.id } });
          if (again?.paymentStatus === 'PAID') {
            return { alreadyPaid: true, orderNo: order.orderNo, status: 'PAID' as const };
          }
          throw new BizException(
            BizCode.CONFLICT,
            `order.statusNotPayable:${again?.paymentStatus || 'unknown'}`,
          );
        }

        if (order.orderType === 'TOPUP') {
          await this.creditTopup(tx, order);
        } else if (order.orderType === 'VIP_SUB') {
          await this.activateVip(tx, order);
        }
        this.log.log({
          event: 'wallet.creditOnPaid',
          orderNo,
          orderType: order.orderType,
          amountCredits: order.amountCredits?.toString(),
          latencyMs: Date.now() - t0,
        });
        return { alreadyPaid: false, orderNo: order.orderNo, status: 'PAID' as const };
      });
    } catch (e: any) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { alreadyPaid: true, orderNo, status: 'PAID' };
      }
      this.log.error({
        event: 'wallet.creditOnPaid.failed',
        orderNo,
        message: e?.message || String(e),
        latencyMs: Date.now() - t0,
      });
      throw e;
    }
  }

  // ============ 退款（原路退回积分 + 回滚收益/计数）============
  async refundOrder(
    orderNo: string,
    userId: bigint,
    reason?: string,
    opts?: { skipWindow?: boolean },
  ) {
    const order = await this.prisma.order.findUnique({ where: { orderNo } });
    if (!order) throw new BizException(BizCode.NOT_FOUND, 'order.notFound');
    if (order.userId !== userId) {
      this.log.warn({ event: 'wallet.refund.forbidden', orderNo, userId });
      throw new BizException(BizCode.FORBIDDEN, 'common.forbidden');
    }
    // 充值单禁止用户自助退款（防刷积分）；仅允许解锁单自助退
    if (order.orderType === 'TOPUP') {
      this.log.warn({ event: 'wallet.refund.topup_blocked', orderNo, userId });
      throw new BizException(
        BizCode.FORBIDDEN,
        'Đơn nạp không hỗ trợ tự hoàn tiền, vui lòng liên hệ quản trị',
      );
    }
    if (order.orderType !== 'EPISODE_UNLOCK') {
      throw new BizException(BizCode.FORBIDDEN, 'Loại đơn này không hỗ trợ hoàn tiền');
    }
    if (order.paymentStatus === 'REFUNDED') {
      return { refunded: true, alreadyRefunded: true, orderNo };
    }
    if (order.paymentStatus !== 'PAID') {
      throw new BizException(BizCode.ORDER_NOT_PAID, 'order.unpaidCannotCompleteRefund');
    }
    const paidAt = order.paidAt ? new Date(order.paidAt).getTime() : 0;
    const REFUND_WINDOW_MS = 2 * 60 * 60 * 1000;
    const skipWindow = !!opts?.skipWindow || String(reason || '').startsWith('admin-');
    if (!skipWindow && (!paidAt || Date.now() - paidAt > REFUND_WINDOW_MS)) {
      throw new BizException(BizCode.FORBIDDEN, 'wallet.refundWindowExpired');
    }

    const t0 = Date.now();
    const result = await this.prisma.$transaction(async (tx) => {
      // 条件更新抢占：并发二次退款直接幂等返回，避免双倍入账/计数回滚
      const claimed = await tx.order.updateMany({
        where: { id: order.id, paymentStatus: 'PAID' },
        data: { paymentStatus: 'REFUNDED', refundedAt: new Date() },
      });
      if (claimed.count !== 1) {
        return { refunded: true, alreadyRefunded: true, orderNo };
      }

      let credited = false;
      for (let attempt = 0; attempt < WALLET_RETRY; attempt++) {
        const wallet = await tx.wallet.findUnique({ where: { userId } });
        if (!wallet) break;
        const newBalance = wallet.balanceCredits + order.amountCredits;
        const res = await tx.wallet.updateMany({
          where: { userId, version: wallet.version },
          data: {
            balanceCredits: { increment: order.amountCredits },
            totalSpentCredits: { decrement: order.amountCredits },
            version: { increment: 1 },
          },
        });
        if (res.count === 1) {
          await tx.walletTransaction.create({
            data: {
              walletUserId: userId,
              type: 'REFUND',
              amountCredits: order.amountCredits,
              orderId: order.id,
              balanceAfter: newBalance,
              remark: reason || 'Hoàn tiền',
            },
          });
          credited = true;
          break;
        }
      }
      if (!credited) {
        throw new BizException(BizCode.CONFLICT, 'Hoàn tiền thất bại, vui lòng thử lại');
      }

      if (order.orderType === 'EPISODE_UNLOCK' && order.creatorId) {
        const currentOrder = await tx.order.findUnique({
          where: { id: order.id },
          select: { earningSettled: true },
        });
        const income = order.creatorIncomeVnd;
        if (income > 0n) {
          const reversed = currentOrder?.earningSettled
            ? await tx.creatorEarning.updateMany({
                where: {
                  creatorId: order.creatorId,
                  availableVnd: { gte: income },
                  totalEarnedVnd: { gte: income },
                },
                data: {
                  availableVnd: { decrement: income },
                  totalEarnedVnd: { decrement: income },
                },
              })
            : await tx.creatorEarning.updateMany({
                where: {
                  creatorId: order.creatorId,
                  pendingVnd: { gte: income },
                  totalEarnedVnd: { gte: income },
                },
                data: {
                  pendingVnd: { decrement: income },
                  totalEarnedVnd: { decrement: income },
                },
              });
          if (reversed.count !== 1) {
            throw new BizException(
              BizCode.CONFLICT,
              'creator.earningInsufficientForRefund',
            );
          }
        }
        const removedUnlock = await tx.userUnlock.deleteMany({
          where: { userId, episodeId: order.episodeId! },
        });
        if (removedUnlock.count === 1) {
          if (order.episodeId) {
            await tx.episode.update({
              where: { id: order.episodeId },
              data: { unlockCount: { decrement: 1 } },
            });
          }
          if (order.dramaId) {
            await tx.drama.update({
              where: { id: order.dramaId },
              data: { unlockCount: { decrement: 1 } },
            });
          }
        } else {
          throw new BizException(BizCode.CONFLICT, 'wallet.unlockRecordMissing');
        }
      }
      return { refunded: true, alreadyRefunded: false, orderNo };
    });
    this.log.log({
      event: 'wallet.refund.ok',
      orderNo,
      userId,
      amountCredits: order.amountCredits?.toString(),
      latencyMs: Date.now() - t0,
    });
    return result;
  }

  /**
   * 管理员审批充值退款：扣回已入账积分（余额不足则拒绝）。
   * 用户侧禁止自助 TOPUP 退款，仅走审批工单。
   */
  async refundTopupByAdmin(orderNo: string, reason?: string) {
    const order = await this.prisma.order.findUnique({ where: { orderNo } });
    if (!order) throw new BizException(BizCode.NOT_FOUND, 'order.notFound');
    if (order.orderType !== 'TOPUP') {
      throw new BizException(BizCode.FORBIDDEN, 'Chỉ dùng cho đơn nạp');
    }
    if (order.paymentStatus === 'REFUNDED') {
      return { refunded: true, alreadyRefunded: true, orderNo };
    }
    if (order.paymentStatus !== 'PAID') {
      throw new BizException(BizCode.ORDER_NOT_PAID, 'order.unpaidCannotCompleteRefund');
    }

    const t0 = Date.now();
    const credits = order.amountCredits;
    const result = await this.prisma.$transaction(async (tx) => {
      // 先抢占订单状态，防止并发审批双扣积分
      const claimed = await tx.order.updateMany({
        where: { id: order.id, paymentStatus: 'PAID' },
        data: {
          paymentStatus: 'REFUNDED',
          refundedAt: new Date(),
          refundReason: reason || 'admin-approve',
        },
      });
      if (claimed.count !== 1) {
        return { refunded: true, alreadyRefunded: true, orderNo };
      }

      for (let attempt = 0; attempt < WALLET_RETRY; attempt++) {
        const w = await tx.wallet.findUnique({ where: { userId: order.userId } });
        if (!w) {
          throw new BizException(BizCode.NOT_FOUND, 'wallet.notFound');
        }
        // Allow negative balance (debt) so channel-side refunds can always settle locally.
        const newBalance = w.balanceCredits - credits;
        const res = await tx.wallet.updateMany({
          where: { userId: order.userId, version: w.version },
          data: {
            balanceCredits: { decrement: credits },
            totalRechargedCredits: { decrement: credits },
            version: { increment: 1 },
          },
        });
        if (res.count === 1) {
          await tx.walletTransaction.create({
            data: {
              walletUserId: order.userId,
              type: 'REFUND',
              amountCredits: -credits,
              orderId: order.id,
              balanceAfter: newBalance,
              remark:
                (reason || 'Hoàn nạp') +
                (newBalance < 0n ? ' (debt/negative balance)' : ''),
            },
          });
          break;
        }
        if (attempt === WALLET_RETRY - 1) {
          throw new BizException(BizCode.CONFLICT, 'Ví đang bận, thử lại');
        }
      }
      return { refunded: true, alreadyRefunded: false, orderNo };
    });
    this.log.log({
      event: 'wallet.refund.topup.ok',
      orderNo,
      userId: order.userId,
      amountCredits: credits?.toString(),
      latencyMs: Date.now() - t0,
    });
    return result;
  }

  // ---- internals ----
  private async ensureWallet(userId: bigint) {
    await this.prisma.wallet.upsert({ where: { userId }, create: { userId }, update: {} });
  }

  private async findOrCreateUnlockOrderTx(
    tx: Prisma.TransactionClient,
    userId: bigint,
    episode: any,
    idem: string,
  ) {
    const existing = await tx.order.findUnique({ where: { idempotencyKey: idem } });
    // 已退款订单不可复用：否则会被后续解锁误判为同订单重复入账（P2002 吞掉扣款流水），
    // 且订单状态会被重新置为 PAID，覆盖掉退款记录。已退款视为"未找到"，走新订单。
    if (existing && existing.paymentStatus !== 'REFUNDED') return existing;

    const creator = await tx.creator.findUnique({ where: { id: episode.drama.creatorId } });
    const share = creator?.revenueShare ?? (await this.defaultRevenueShare());
    // Charge credits from wallet; money columns are USD cents (never raw credits).
    const credits =
      episode.priceCredits > 0n
        ? episode.priceCredits
        : episode.priceVnd > 0n
          ? episode.priceVnd
          : 0n;
    const ledger = await this.splitCreditsToUsdLedger(credits, share);

    return tx.order.create({
      data: {
        orderNo: genOrderNo('UL'),
        idempotencyKey: existing ? `${idem}:r${existing.id}` : idem,
        userId,
        creatorId: episode.drama.creatorId,
        orderType: 'EPISODE_UNLOCK',
        episodeId: episode.id,
        dramaId: episode.dramaId,
        amountVnd: ledger.amountUsdCents,
        amountCredits: credits,
        creatorIncomeVnd: ledger.creatorIncomeUsdCents,
        platformFeeVnd: ledger.platformFeeUsdCents,
        payCurrency: 'USD',
        payAmount: new Prisma.Decimal(usdCentsToPayAmountMajor(ledger.amountUsdCents)),
        fxRate: new Prisma.Decimal(String(ledger.usdCentsPerCredit)),
        fxSource: ledger.financeFrozen ? 'wallet-credits-frozen' : 'wallet-credits',
        paymentMethod: 'WALLET',
        paymentStatus: 'PENDING',
        meta: {
          revenueShare: share.toString(),
          ledgerCurrency: 'USD',
          ledgerMinorUnit: 'USD_CENTS',
          ledgerDirty: false,
          usdCentsPerCredit: ledger.usdCentsPerCredit,
          financeFrozen: ledger.financeFrozen,
          deferredCreatorIncomeUsdCents: ledger.deferredCreatorIncomeUsdCents?.toString() ?? null,
          creatorAccrualSkipped: ledger.financeFrozen,
        } as any,
      },
    });
  }

  private async chargeWalletTx(
    tx: Prisma.TransactionClient,
    userId: bigint,
    amount: bigint,
    orderId: bigint,
    type: 'TOPUP' | 'UNLOCK' | 'REFUND',
    remark: string,
  ): Promise<boolean> {
    const already = await tx.walletTransaction.findFirst({
      where: { orderId, type },
      select: { id: true },
    });
    if (already) return true;

    for (let attempt = 0; attempt < WALLET_RETRY; attempt++) {
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet || wallet.balanceCredits < amount) return false;
      const newBalance = wallet.balanceCredits - amount;
      const res = await tx.wallet.updateMany({
        where: { userId, version: wallet.version },
        data: {
          balanceCredits: newBalance,
          totalSpentCredits: { increment: amount },
          version: { increment: 1 },
        },
      });
      if (res.count === 1) {
        try {
          await tx.walletTransaction.create({
            data: {
              walletUserId: userId,
              type,
              amountCredits: -amount,
              orderId,
              balanceAfter: newBalance,
              remark,
            },
          });
          return true;
        } catch (e: any) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            // Concurrent loser debited after peer already wrote ledger — compensate.
            await tx.wallet.update({
              where: { userId },
              data: {
                balanceCredits: { increment: amount },
                totalSpentCredits: { decrement: amount },
                version: { increment: 1 },
              },
            });
            return true;
          }
          throw e;
        }
      }
    }
    return false;
  }

  /**
   * Stripe charge.refunded / refund.updated：回收 TOPUP 积分或缩短 VIP。
   * 幂等：已 REFUNDED 直接返回。
   */
  async revokeOnProviderRefund(
    orderNo: string,
    reason?: string,
    provider?: {
      providerRefundId?: string;
      amountMinor?: number;
      currency?: string;
    },
  ) {
    const order = await this.prisma.order.findUnique({ where: { orderNo } });
    if (!order) throw new BizException(BizCode.NOT_FOUND, 'order.notFound');
    if (order.paymentStatus === 'REFUNDED') {
      return { refunded: true, alreadyRefunded: true, orderNo };
    }
    if (order.paymentStatus !== 'PAID') {
      throw new BizException(BizCode.ORDER_NOT_PAID, 'order.unpaidCannotCompleteRefund');
    }
    if (provider?.providerRefundId || provider?.amountMinor != null) {
      const prevMeta = order.meta && typeof order.meta === 'object' ? (order.meta as any) : {};
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          meta: {
            ...prevMeta,
            stripeRefundId: provider.providerRefundId ?? prevMeta.stripeRefundId,
            stripeRefundAmountMinor: provider.amountMinor ?? prevMeta.stripeRefundAmountMinor,
            stripeRefundCurrency: provider.currency ?? prevMeta.stripeRefundCurrency,
            ledgerCurrency: prevMeta.ledgerCurrency || 'USD',
          } as any,
        },
      });
    }
    if (order.orderType === 'TOPUP') {
      return this.refundTopupByAdmin(orderNo, reason || 'Stripe refund');
    }
    if (order.orderType === 'VIP_SUB') {
      return this.prisma.$transaction(async (tx) => {
        const claimed = await tx.order.updateMany({
          where: { id: order.id, paymentStatus: 'PAID' },
          data: { paymentStatus: 'REFUNDED', refundedAt: new Date() },
        });
        if (claimed.count !== 1) {
          return { refunded: true, alreadyRefunded: true, orderNo };
        }
        let durationDays = 0;
        if (order.vipPlanId) {
          const plan = await tx.vipPlan.findUnique({ where: { id: order.vipPlanId } });
          durationDays = plan?.durationDays ?? 0;
        }
        if (!durationDays && order.meta && typeof order.meta === 'object') {
          durationDays = Number((order.meta as any).durationDays) || 0;
        }
        if (durationDays > 0) {
          const user = await tx.user.findUnique({
            where: { id: order.userId },
            select: { vipExpireAt: true },
          });
          if (user?.vipExpireAt) {
            const next = new Date(user.vipExpireAt.getTime() - durationDays * 86400000);
            const floor = new Date();
            await tx.user.update({
              where: { id: order.userId },
              data: { vipExpireAt: next > floor ? next : floor },
            });
          }
        }
        return { refunded: true, alreadyRefunded: false, orderNo };
      });
    }
    throw new BizException(BizCode.FORBIDDEN, 'order.typeNoRefund');
  }

  private async activateVip(tx: Prisma.TransactionClient, order: any) {
    let durationDays = 0;
    if (order.vipPlanId) {
      const plan = await tx.vipPlan.findUnique({ where: { id: order.vipPlanId } });
      durationDays = plan?.durationDays ?? 0;
    }
    if (!durationDays && order.meta && typeof order.meta === 'object') {
      durationDays = Number((order.meta as any).durationDays) || 0;
    }
    if (durationDays < 1) {
      throw new BizException(BizCode.BAD_REQUEST, 'VIP plan duration không hợp lệ');
    }

    const user = await tx.user.findUnique({
      where: { id: order.userId },
      select: { vipExpireAt: true },
    });
    const vipExpireAt = VipPlansService.computeExpireAt(user?.vipExpireAt, durationDays);
    await tx.user.update({
      where: { id: order.userId },
      data: { vipExpireAt },
    });

    try {
      await tx.notification.create({
        data: {
          userId: order.userId,
          type: 'VIP_SUCCESS',
          titleEn: 'VIP activated successfully',
          titleZh: 'VIP 开通成功',
          bodyEn: `VIP is valid until ${vipExpireAt.toISOString()}.`,
          bodyZh: `VIP 有效期至 ${vipExpireAt.toISOString()}。`,
          payload: {
            orderNo: order.orderNo,
            vipExpireAt: vipExpireAt.toISOString(),
            durationDays,
          } as any,
        },
      });
    } catch {
      /* best-effort */
    }
  }

  private async creditTopup(tx: Prisma.TransactionClient, order: any) {
    const credits = order.amountCredits ?? 0n;
    let finalBalance = 0n;
    let credited = false;
    for (let attempt = 0; attempt < WALLET_RETRY; attempt++) {
      const wallet = await tx.wallet.findUnique({ where: { userId: order.userId } });
      if (!wallet) {
        await tx.wallet.create({
          data: { userId: order.userId, balanceCredits: credits, totalRechargedCredits: credits },
        });
        await tx.walletTransaction.create({
          data: {
            walletUserId: order.userId,
            type: 'TOPUP',
            amountCredits: credits,
            orderId: order.id,
            balanceAfter: credits,
            remark: 'Nạp tiền',
          },
        });
        finalBalance = credits;
        credited = true;
        break;
      }
      const newBalance = wallet.balanceCredits + credits;
      const res = await tx.wallet.updateMany({
        where: { userId: order.userId, version: wallet.version },
        data: {
          balanceCredits: { increment: credits },
          totalRechargedCredits: { increment: credits },
          version: { increment: 1 },
        },
      });
      if (res.count === 1) {
        await tx.walletTransaction.create({
          data: {
            walletUserId: order.userId,
            type: 'TOPUP',
            amountCredits: credits,
            orderId: order.id,
            balanceAfter: newBalance,
            remark: 'Nạp tiền',
          },
        });
        finalBalance = newBalance;
        credited = true;
        break;
      }
    }
    // Do not treat balance===0 as failure: topping up a negative balance to exactly 0 is valid.
    if (!credited) {
      throw new BizException(BizCode.CONFLICT, 'wallet.updateFailed');
    }

    // 用户通知：充值成功
    try {
      await tx.notification.create({
        data: {
          userId: order.userId,
          type: 'TOPUP_SUCCESS',
          titleEn: 'Top-up successful',
          titleZh: '充值成功',
          bodyEn: `${credits} credits added to your wallet. Current balance: ${finalBalance} credits.`,
          bodyZh: `已到账 ${credits} 积分，当前余额：${finalBalance} 积分。`,
          payload: {
            orderNo: order.orderNo,
            credits: credits.toString(),
            balanceAfter: finalBalance.toString(),
          } as any,
        },
      });
    } catch {
      /* notification best-effort */
    }
  }

  /**
   * Accrue creator pending income in **USD cents** (legacy *Vnd columns).
   * No-ops while FINANCE_OPS_FROZEN — stops mixing credits/VND into withdrawable balances.
   */
  private async creditCreator(
    tx: Prisma.TransactionClient,
    creatorId: bigint,
    incomeUsdCents: bigint,
  ) {
    if (isFinanceOpsFrozen() || incomeUsdCents <= 0n) return;
    const earning = await tx.creatorEarning.findUnique({ where: { creatorId } });
    if (earning) {
      await tx.creatorEarning.update({
        where: { creatorId },
        data: {
          pendingVnd: { increment: incomeUsdCents },
          totalEarnedVnd: { increment: incomeUsdCents },
        },
      });
    } else {
      await tx.creatorEarning.create({
        data: {
          creatorId,
          pendingVnd: incomeUsdCents,
          totalEarnedVnd: incomeUsdCents,
          availableVnd: 0n,
          withdrawnVnd: 0n,
        },
      });
    }
  }

  /**
   * Split wallet credit spend into USD-cents ledger fields.
   * Fail-closed without USD_CENTS_PER_CREDIT (no silent dirty money columns).
   *
   * While FINANCE_OPS_FROZEN: keep amountUsdCents for the order, but write
   * creatorIncomeVnd=0 and store deferredCreatorIncomeUsdCents in meta so T+7
   * cannot settle debt that was never accrued to pendingVnd.
   */
  private async splitCreditsToUsdLedger(credits: bigint, share: Prisma.Decimal) {
    const ledger = splitWalletCreditsLedger(credits, Number(share), {
      usdCentsPerCredit: resolveUsdCentsPerCredit(null),
      financeFrozen: isFinanceOpsFrozen(),
    });
    if (!ledger) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        'ledger.usdCentsPerCreditRequired',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return ledger;
  }

  private async attachStripeCheckout(
    base: Record<string, any>,
    opts: {
      orderNo: string;
      userId: bigint;
      productName: string;
      payAmountMajor: string;
      currency: string;
      orderType: string;
    },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: opts.userId },
      select: { email: true },
    });
    const session = await createStripeCheckoutSession(this.prisma, {
      orderNo: opts.orderNo,
      userId: opts.userId,
      productName: opts.productName,
      payAmountMajor: opts.payAmountMajor,
      currency: opts.currency,
      customerEmail: user?.email,
      metadata: { orderType: opts.orderType },
    });
    base.checkoutUrl = session.checkoutUrl;
    base.checkout_url = session.checkoutUrl;
    base.stripeSessionId = session.sessionId;
    this.log.log({
      event: 'payments.stripe.checkout_created',
      orderNo: opts.orderNo,
      orderType: opts.orderType,
      sessionId: session.sessionId,
    });
  }

  private orderView(order: any) {
    return {
      orderNo: order.orderNo,
      orderType: order.orderType,
      packageId: order.packageId?.toString?.() ?? order.packageId ?? null,
      amountVnd: order.amountVnd.toString(),
      amountCredits: (order.amountCredits ?? 0n).toString(),
      payAmount: order.payAmount?.toString?.() ?? order.payAmount ?? null,
      fxRate: order.fxRate?.toString?.() ?? order.fxRate ?? null,
      creatorIncomeVnd: order.creatorIncomeVnd.toString(),
      platformFeeVnd: order.platformFeeVnd.toString(),
      payCurrency: order.payCurrency,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      createdAt: order.createdAt,
    };
  }
}

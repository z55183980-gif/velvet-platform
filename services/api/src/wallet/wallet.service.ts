import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import { toBigInt, genOrderNo, toDecimal } from '../common/money.util';
import { ExchangeService } from '../exchange/exchange.service';
import { PackagesService } from '../packages/packages.service';
import { VipPlansService } from '../vip/vip-plans.service';
import { StructuredLogger } from '../common/structured-logger.service';
import { LockAccessService } from '../common/lock-access.service';

const WALLET_RETRY = 3;

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exchange: ExchangeService,
    private readonly packages: PackagesService,
    private readonly vipPlans: VipPlansService,
    private readonly log: StructuredLogger,
    private readonly lockAccess: LockAccessService,
  ) {}

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

  // ============ 充值下单（选套餐 + 支付币种；积分以套餐为准）============
  async createTopupOrder(
    dto: {
      packageId: number | string;
      currency: string;
      paymentMethod?: string;
      idempotencyKey?: string;
    },
    userId: bigint,
  ) {
    const currency = (dto.currency || 'CNY').toUpperCase();
    const pkg = await this.packages.getActive(toBigInt(dto.packageId));
    const quote = await this.exchange.quoteBasePrice(pkg.basePrice, currency);
    const payAmount = new Prisma.Decimal(quote.payAmount);
    const credits = pkg.credits;
    if (credits <= 0n) throw new BizException(BizCode.BAD_REQUEST, 'Gói nạp không hợp lệ');

    const idem =
      dto.idempotencyKey ||
      `topup:${userId}:pkg${pkg.id}:${currency}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
    const existing = await this.prisma.order.findUnique({ where: { idempotencyKey: idem } });
    if (existing) return this.orderView(existing);

    const amountVnd = await this.exchange.fiatToVnd(currency, payAmount);
    const method = (dto.paymentMethod || 'STRIPE') as any;

    // 首期：支付宝仅支持 CNY
    if (method === 'ALIPAY' && currency !== 'CNY') {
      throw new BizException(
        BizCode.BAD_REQUEST,
        'Alipay chỉ hỗ trợ thanh toán CNY; vui lòng chọn CNY hoặc phương thức khác',
      );
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
        fxRate: new Prisma.Decimal(quote.cnyToFiat),
        fxSource: 'cnyToFiat',
        paymentMethod: method,
        paymentStatus: 'PENDING',
      },
    });

    const base: any = {
      ...this.orderView(order),
      credits: credits.toString(),
      packageId: pkg.id.toString(),
      packageName: pkg.name,
      basePriceCny: pkg.basePrice.toString(),
    };

    if (method === 'ALIPAY') {
      // 开源版不内置真实渠道 SDK。
      // 部署时接入方应在自己的支付服务里生成跳转链接 / 表单，
      // 并通过 webhook 回写 PAID 状态。本函数仅返回订单与提示。
      return {
        ...base,
        amountYuan: payAmount.toFixed(2),
        notice: '开源版未集成支付渠道 SDK，请接入真实渠道后返回 payUrl/payForm',
      };
    }

    if (process.env.NODE_ENV !== 'production') {
      base.devPayUrl = `/api/v1/payments/simulate?orderNo=${order.orderNo}`;
      base.simulate = true;
    }
    return base;
  }

  // ============ VIP 订阅下单（法币支付，成功后延长 vipExpireAt）============
  async createVipSubOrder(
    dto: {
      vipPlanId: number | string;
      currency: string;
      paymentMethod?: string;
      idempotencyKey?: string;
    },
    userId: bigint,
  ) {
    const currency = (dto.currency || 'CNY').toUpperCase();
    const plan = await this.vipPlans.getActive(toBigInt(dto.vipPlanId));
    const quote = await this.exchange.quoteBasePrice(plan.basePrice, currency);
    const payAmount = new Prisma.Decimal(quote.payAmount);

    const idem =
      dto.idempotencyKey ||
      `vip:${userId}:plan${plan.id}:${currency}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
    const existing = await this.prisma.order.findUnique({ where: { idempotencyKey: idem } });
    if (existing) return this.orderView(existing);

    const amountVnd = await this.exchange.fiatToVnd(currency, payAmount);
    const method = (dto.paymentMethod || 'STRIPE') as any;

    if (method === 'ALIPAY' && currency !== 'CNY') {
      throw new BizException(
        BizCode.BAD_REQUEST,
        'Alipay chỉ hỗ trợ thanh toán CNY; vui lòng chọn CNY hoặc phương thức khác',
      );
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
        fxRate: new Prisma.Decimal(quote.cnyToFiat),
        fxSource: 'cnyToFiat',
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
      basePriceCny: plan.basePrice.toString(),
    };

    if (method === 'ALIPAY') {
      return {
        ...base,
        amountYuan: payAmount.toFixed(2),
        notice: '开源版未集成支付渠道 SDK，请接入真实渠道后返回 payUrl/payForm',
      };
    }

    if (process.env.NODE_ENV !== 'production') {
      base.devPayUrl = `/api/v1/payments/simulate?orderNo=${order.orderNo}`;
      base.simulate = true;
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
          const share = creator?.revenueShare ?? new Prisma.Decimal(0.7);
          // 用积分×参考：amountVnd 存 0（积分计价）；创作者分润按 0 或后续扩展
          order = await tx.order.create({
            data: {
              orderNo: genOrderNo('DB'),
              idempotencyKey: idem,
              userId,
              creatorId: drama.creatorId,
              orderType: 'DRAMA_BUYOUT',
              dramaId,
              amountVnd: 0n,
              amountCredits: buyout,
              creatorIncomeVnd: 0n,
              platformFeeVnd: 0n,
              payCurrency: 'CREDITS',
              payAmount: new Prisma.Decimal(buyout.toString()),
              fxRate: new Prisma.Decimal(1),
              fxSource: 'wallet',
              paymentMethod: 'WALLET',
              paymentStatus: 'PENDING',
              meta: { revenueShare: share.toString() } as any,
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
    if (existing) {
      return {
        unlocked: true,
        alreadyUnlocked: true,
        isFree: existing.orderId === null,
        episodeId: episodeId.toString(),
        unlockId: existing.id.toString(),
        orderId: existing.orderId?.toString() ?? null,
      };
    }

    const episode = await this.prisma.episode.findUnique({
      where: { id: episodeId },
      include: { drama: true },
    });
    if (!episode) throw new BizException(BizCode.NOT_FOUND, 'Tập phim không tồn tại');

    const isFree = this.lockAccess.isFree(
      episode,
      await this.lockAccess.resolveForDrama(episode.drama),
    );

    // VIP / 整剧买断：软解锁（不扣积分）
    if (!isFree) {
      const [user, dramaUnlock] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: userId }, select: { vipExpireAt: true } }),
        this.prisma.userDramaUnlock.findUnique({
          where: { userId_dramaId: { userId, dramaId: episode.dramaId } },
        }),
      ]);
      const vipActive = !!(user?.vipExpireAt && user.vipExpireAt.getTime() > Date.now());
      if (vipActive || dramaUnlock) {
        try {
          const rec = await this.prisma.userUnlock.create({ data: { userId, episodeId } });
          await this.prisma.episode.update({
            where: { id: episodeId },
            data: { unlockCount: { increment: 1 } },
          });
          return {
            unlocked: true,
            alreadyUnlocked: false,
            isFree: false,
            viaVip: vipActive,
            viaDramaBuyout: !!dramaUnlock,
            episodeId: episodeId.toString(),
            unlockId: rec.id.toString(),
            orderId: null,
          };
        } catch (e: any) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            const again = await this.prisma.userUnlock.findUnique({
              where: { userId_episodeId: { userId, episodeId } },
            });
            return {
              unlocked: true,
              alreadyUnlocked: true,
              isFree: false,
              viaVip: vipActive,
              viaDramaBuyout: !!dramaUnlock,
              episodeId: episodeId.toString(),
              unlockId: again?.id.toString() ?? null,
              orderId: null,
            };
          }
          throw e;
        }
      }
    }

    if (isFree) {
      try {
        const rec = await this.prisma.userUnlock.create({ data: { userId, episodeId } });
        await this.prisma.episode.update({
          where: { id: episodeId },
          data: { unlockCount: { increment: 1 } },
        });
        return {
          unlocked: true,
          alreadyUnlocked: false,
          isFree: true,
          episodeId: episodeId.toString(),
          unlockId: rec.id.toString(),
          orderId: null,
        };
      } catch (e: any) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          const again = await this.prisma.userUnlock.findUnique({
            where: { userId_episodeId: { userId, episodeId } },
          });
          return {
            unlocked: true,
            alreadyUnlocked: true,
            isFree: true,
            episodeId: episodeId.toString(),
            unlockId: again?.id.toString() ?? null,
            orderId: null,
          };
        }
        throw e;
      }
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
        await tx.order.update({
          where: { id: order.id },
          data: { paymentStatus: 'PAID', paidAt, payAmount: new Prisma.Decimal(order.amountVnd.toString()), fxRate: new Prisma.Decimal(1), fxSource: 'wallet' },
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
        if (!order) throw new BizException(BizCode.NOT_FOUND, 'Đơn hàng không tồn tại');
        if (order.paymentStatus === 'REFUNDED') {
          throw new BizException(
            BizCode.CONFLICT,
            'Đơn hàng đã hoàn tiền, không thể đánh dấu PAID',
          );
        }
        if (order.paymentStatus === 'PAID') {
          return { alreadyPaid: true, orderNo: order.orderNo, status: order.paymentStatus };
        }

        await tx.order.update({
          where: { id: order.id },
          data: {
            paymentStatus: 'PAID',
            externalRef: opts?.externalRef,
            paidAt: new Date(),
            payCurrency: opts?.currency ?? order.payCurrency,
            payAmount: opts?.payAmount != null ? toDecimal(opts.payAmount as any) : undefined,
            fxSource: order.fxSource || 'webhook',
          },
        });

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
  async refundOrder(orderNo: string, userId: bigint, reason?: string) {
    const order = await this.prisma.order.findUnique({ where: { orderNo } });
    if (!order) throw new BizException(BizCode.NOT_FOUND, 'Đơn hàng không tồn tại');
    if (order.userId !== userId) {
      this.log.warn({ event: 'wallet.refund.forbidden', orderNo, userId });
      throw new BizException(BizCode.FORBIDDEN, 'Không có quyền');
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
      throw new BizException(BizCode.ORDER_NOT_PAID, 'Đơn hàng chưa thanh toán, không thể hoàn');
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
          break;
        }
      }

      if (order.orderType === 'EPISODE_UNLOCK' && order.creatorId) {
        if (order.earningSettled) {
          await tx.creatorEarning.updateMany({
            where: { creatorId: order.creatorId },
            data: { availableVnd: { decrement: order.creatorIncomeVnd } },
          });
        } else {
          await tx.creatorEarning.updateMany({
            where: { creatorId: order.creatorId },
            data: { pendingVnd: { decrement: order.creatorIncomeVnd } },
          });
        }
        await tx.userUnlock.deleteMany({ where: { userId, episodeId: order.episodeId! } });
        if (order.episodeId) {
          await tx.episode.update({ where: { id: order.episodeId }, data: { unlockCount: { decrement: 1 } } });
        }
        if (order.dramaId) {
          await tx.drama.update({ where: { id: order.dramaId }, data: { unlockCount: { decrement: 1 } } });
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
    if (!order) throw new BizException(BizCode.NOT_FOUND, 'Đơn hàng không tồn tại');
    if (order.orderType !== 'TOPUP') {
      throw new BizException(BizCode.FORBIDDEN, 'Chỉ dùng cho đơn nạp');
    }
    if (order.paymentStatus === 'REFUNDED') {
      return { refunded: true, alreadyRefunded: true, orderNo };
    }
    if (order.paymentStatus !== 'PAID') {
      throw new BizException(BizCode.ORDER_NOT_PAID, 'Đơn hàng chưa thanh toán, không thể hoàn');
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
        if (!w || w.balanceCredits < credits) {
          throw new BizException(
            BizCode.CONFLICT,
            'Số dư credits không đủ để hoàn (người dùng đã tiêu hết)',
          );
        }
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
              remark: reason || 'Hoàn nạp (admin)',
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
    if (existing) return existing;

    const creator = await tx.creator.findUnique({ where: { id: episode.drama.creatorId } });
    const share = creator?.revenueShare ?? new Prisma.Decimal(0.7);
    const price = episode.priceVnd;
    const creatorIncome = toBigInt(Math.floor(Number(price) * Number(share)));
    const platformFee = price - creatorIncome;

    return tx.order.create({
      data: {
        orderNo: genOrderNo('UL'),
        idempotencyKey: idem,
        userId,
        creatorId: episode.drama.creatorId,
        orderType: 'EPISODE_UNLOCK',
        episodeId: episode.id,
        dramaId: episode.dramaId,
        amountVnd: price,
        amountCredits: episode.priceCredits,
        creatorIncomeVnd: creatorIncome,
        platformFeeVnd: platformFee,
        payCurrency: 'VND',
        payAmount: new Prisma.Decimal(price.toString()),
        fxRate: new Prisma.Decimal(1),
        fxSource: 'wallet',
        paymentMethod: 'WALLET',
        paymentStatus: 'PENDING',
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
            return true; // 同订单同类型已入账
          }
          throw e;
        }
      }
    }
    return false;
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
          titleVi: 'Kích hoạt VIP thành công',
          titleZh: 'VIP 开通成功',
          bodyVi: `VIP còn hiệu lực đến ${vipExpireAt.toISOString()}.`,
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
        break;
      }
    }
    if (finalBalance === 0n) {
      throw new BizException(BizCode.CONFLICT, 'Cập nhật ví thất bại, vui lòng thử lại');
    }

    // 用户通知：充值成功
    try {
      await tx.notification.create({
        data: {
          userId: order.userId,
          type: 'TOPUP_SUCCESS',
          titleVi: 'Nạp tiền thành công',
          titleZh: '充值成功',
          bodyVi: `Đã nạp ${credits} credits vào ví. Số dư hiện tại: ${finalBalance} credits.`,
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

  private async creditCreator(
    tx: Prisma.TransactionClient,
    creatorId: bigint,
    incomeVnd: bigint,
  ) {
    const earning = await tx.creatorEarning.findUnique({ where: { creatorId } });
    if (earning) {
      await tx.creatorEarning.update({
        where: { creatorId },
        data: { pendingVnd: { increment: incomeVnd }, totalEarnedVnd: { increment: incomeVnd } },
      });
    } else {
      await tx.creatorEarning.create({
        data: {
          creatorId,
          pendingVnd: incomeVnd,
          totalEarnedVnd: incomeVnd,
          availableVnd: 0n,
          withdrawnVnd: 0n,
        },
      });
    }
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

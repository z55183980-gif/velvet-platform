import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import { AuditService } from '../common/audit.service';
import { WalletService } from '../wallet/wallet.service';
import { createStripeRefund } from '../payments/stripe-refund';

@Injectable()
export class AdminRefundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly wallet: WalletService,
  ) {}

  /**
   * For Stripe-paid TOPUP/VIP: call Stripe Refund API before local credit/VIP revoke.
   * Stores provider refund id on order.meta (idempotent via Stripe Idempotency-Key).
   */
  private async ensureProviderRefund(order: {
    id: bigint;
    orderNo: string;
    paymentMethod: string;
    paymentStatus: string;
    externalRef: string | null;
    amountVnd: bigint;
    payCurrency: string;
    meta: unknown;
    orderType: string;
  }) {
    if (order.paymentMethod !== 'STRIPE') return null;
    if (order.orderType !== 'TOPUP' && order.orderType !== 'VIP_SUB') return null;

    const prevMeta = order.meta && typeof order.meta === 'object' ? (order.meta as any) : {};
    if (prevMeta.stripeRefundId) {
      return {
        refundId: String(prevMeta.stripeRefundId),
        alreadyRefunded: true,
        amountMinor: Number(prevMeta.stripeRefundAmountMinor) || Number(order.amountVnd),
        currency: String(prevMeta.stripeRefundCurrency || 'usd'),
        status: 'succeeded',
      };
    }

    const paymentRef = String(order.externalRef || prevMeta.stripePaymentIntentId || '').trim();
    if (!paymentRef) {
      throw new BizException(BizCode.BAD_REQUEST, 'stripe.refundMissingPaymentRef');
    }

    const amountMinor = Number(order.amountVnd);
    const stripe = await createStripeRefund({
      paymentIntentOrChargeId: paymentRef,
      amountMinor: Number.isFinite(amountMinor) && amountMinor > 0 ? amountMinor : undefined,
      idempotencyKey: `velvet-refund:${order.orderNo}`,
      metadata: { orderNo: order.orderNo, order_no: order.orderNo },
    });

    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        meta: {
          ...prevMeta,
          stripeRefundId: stripe.refundId,
          stripeRefundAmountMinor: stripe.amountMinor,
          stripeRefundCurrency: stripe.currency,
          stripeRefundStatus: stripe.status,
          ledgerCurrency: 'USD',
        } as any,
      },
    });
    return stripe;
  }

  /** 列出工单：refundStatus = REQUESTED */
  async listRequests(filter: { page?: number; pageSize?: number }) {
    const page = Math.max(1, Math.floor(filter.page ?? 1));
    const pageSize = Math.min(100, Math.max(5, Math.floor(filter.pageSize ?? 20)));
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where: { refundStatus: 'REQUESTED' },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { id: true, email: true, phone: true, nickname: true } } },
      }),
      this.prisma.order.count({ where: { refundStatus: 'REQUESTED' } }),
    ]);
    return { rows, total, page, pageSize };
  }

  async request(orderNo: string, userId: bigint, note: string) {
    const order = await this.prisma.order.findUnique({ where: { orderNo } });
    if (!order) throw new BizException(BizCode.NOT_FOUND, 'order.notFound');
    if (order.userId !== userId) {
      throw new BizException(BizCode.FORBIDDEN, 'common.forbidden');
    }
    if (order.paymentStatus !== 'PAID') {
      throw new BizException(BizCode.ORDER_NOT_PAID, 'order.unpaidCannotRefund');
    }
    if (order.orderType !== 'TOPUP' && order.orderType !== 'EPISODE_UNLOCK') {
      throw new BizException(BizCode.FORBIDDEN, 'order.typeNoRefund');
    }
    if (order.refundStatus === 'REQUESTED') {
      return { alreadyRequested: true, orderNo };
    }
    if (order.refundStatus === 'APPROVED') {
      throw new BizException(BizCode.CONFLICT, 'Đơn đã hoàn/đang xử lý');
    }
    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: { refundStatus: 'REQUESTED', refundNote: note || null },
    });
    return { orderNo: updated.orderNo, refundStatus: updated.refundStatus };
  }

  async approve(orderNo: string, actorId?: bigint) {
    const order = await this.prisma.order.findUnique({ where: { orderNo } });
    if (!order) throw new BizException(BizCode.NOT_FOUND, 'order.notFound');
    if (order.paymentStatus === 'REFUNDED') {
      // 钱包侧已退完时，仍把工单状态对齐为 APPROVED（幂等）
      if (order.refundStatus !== 'APPROVED') {
        await this.prisma.order.update({
          where: { id: order.id },
          data: { refundStatus: 'APPROVED' },
        });
      }
      return { alreadyRefunded: true, orderNo };
    }
    if (order.paymentStatus !== 'PAID') {
      throw new BizException(BizCode.ORDER_NOT_PAID, 'Đơn chưa thanh toán');
    }

    // Stripe real-money refund first; local credits/VIP revoke second (webhook is idempotent).
    const providerRefund = await this.ensureProviderRefund(order);

    let refund: { refunded: boolean; alreadyRefunded: boolean; orderNo: string };
    if (order.orderType === 'EPISODE_UNLOCK') {
      refund = await this.wallet.refundOrder(orderNo, order.userId, 'admin-approve', {
        skipWindow: true,
      });
    } else if (order.orderType === 'TOPUP') {
      refund = await this.wallet.refundTopupByAdmin(orderNo, 'admin-approve');
    } else if (order.orderType === 'VIP_SUB') {
      refund = await this.wallet.revokeOnProviderRefund(orderNo, 'admin-approve', {
        providerRefundId: providerRefund?.refundId,
        amountMinor: providerRefund?.amountMinor,
        currency: providerRefund?.currency,
      });
    } else {
      throw new BizException(BizCode.FORBIDDEN, 'Loại đơn không hỗ trợ hoàn');
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { refundStatus: 'APPROVED' },
    });
    await this.audit.write({
      actorId,
      action: 'order.refund.approve',
      targetType: 'order',
      targetId: orderNo,
      payload: {
        orderType: order.orderType,
        amountCredits: (order.amountCredits ?? 0n).toString(),
        alreadyRefunded: refund.alreadyRefunded,
        stripeRefundId: providerRefund?.refundId ?? null,
      },
    });
    return { ...refund, stripeRefundId: providerRefund?.refundId ?? null };
  }

  async refuse(orderNo: string, reason: string, actorId?: bigint) {
    if (!reason || !reason.trim()) {
      throw new BizException(BizCode.BAD_REQUEST, 'common.rejectReasonRequired');
    }
    const order = await this.prisma.order.findUnique({ where: { orderNo } });
    if (!order) throw new BizException(BizCode.NOT_FOUND, 'order.notFound');
    if (order.refundStatus !== 'REQUESTED') {
      throw new BizException(BizCode.CONFLICT, '工单状态不允许拒绝');
    }
    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: { refundStatus: 'REFUSED', refundReason: reason },
    });
    await this.audit.write({
      actorId,
      action: 'order.refund.refuse',
      targetType: 'order',
      targetId: orderNo,
      payload: { reason },
    });
    return { orderNo: updated.orderNo, refundStatus: updated.refundStatus };
  }
}

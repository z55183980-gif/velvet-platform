import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import { AuditService } from '../common/audit.service';
import { WalletService } from '../wallet/wallet.service';
import {
  createStripeRefund,
  isFullStripeRefund,
  isStripeRefundSucceeded,
  retrieveStripeRefund,
} from '../payments/stripe-refund';

@Injectable()
export class AdminRefundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly wallet: WalletService,
  ) {}

  /** Terminal Stripe refund statuses that must not block a new refund attempt. */
  private isStaleProviderRefundStatus(status: string | null | undefined): boolean {
    const s = String(status || '')
      .trim()
      .toLowerCase();
    return s === 'failed' || s === 'canceled' || s === 'cancelled';
  }

  /**
   * Partial refunds are unsupported for local entitlement revoke.
   * Succeeded + amount < order/charge ⇒ reject (never full-revoke on partial).
   */
  private async assertFullRefundOrThrow(opts: {
    amountMinor: number;
    orderAmountMinor: number;
    status: string;
    refundId: string;
    currency: string;
    prevMeta: Record<string, unknown>;
    orderId: bigint;
  }) {
    const orderAmount = opts.orderAmountMinor;
    if (
      isStripeRefundSucceeded(opts.status) &&
      opts.amountMinor > 0 &&
      Number.isFinite(orderAmount) &&
      orderAmount > 0 &&
      !isFullStripeRefund({
        refundAmountMinor: opts.amountMinor,
        orderAmountMinor: orderAmount,
      })
    ) {
      // Persist evidence but do not clear id — Stripe already took partial money.
      await this.prisma.order.update({
        where: { id: opts.orderId },
        data: {
          meta: {
            ...opts.prevMeta,
            stripeRefundId: opts.refundId,
            stripeRefundAmountMinor: opts.amountMinor,
            stripeRefundCurrency: opts.currency,
            stripeRefundStatus: opts.status,
            partialRefundPending: true,
            ledgerCurrency: 'USD',
          } as any,
        },
      });
      throw new BizException(BizCode.CONFLICT, 'stripe.partialRefundUnsupported');
    }
  }

  /**
   * For Stripe-paid TOPUP/VIP: ensure a Stripe Refund exists and is verified.
   * Never assumes a historical refund id succeeded — retrieves status from Stripe.
   * Local credit/VIP revoke must only run after **succeeded full** refund (caller checks status;
   * this method rejects partial succeeded amounts).
   * Failed/canceled historical ids are cleared so a new refund can be created.
   */
  private async ensureProviderRefund(
    order: {
      id: bigint;
      orderNo: string;
      paymentMethod: string;
      paymentStatus: string;
      externalRef: string | null;
      amountVnd: bigint;
      payCurrency: string;
      meta: unknown;
      orderType: string;
    },
    opts?: { fetchImpl?: typeof fetch },
  ) {
    if (order.paymentMethod !== 'STRIPE') return null;
    if (order.orderType !== 'TOPUP' && order.orderType !== 'VIP_SUB') return null;

    let prevMeta =
      order.meta && typeof order.meta === 'object' ? { ...(order.meta as any) } : {};
    const amountMinor = Number(order.amountVnd);
    const existingId = String(prevMeta.stripeRefundId || '').trim();

    if (existingId) {
      const retrieved = await retrieveStripeRefund({
        refundId: existingId,
        fetchImpl: opts?.fetchImpl,
      });

      if (this.isStaleProviderRefundStatus(retrieved.status)) {
        // Clear stale id so a new Stripe refund (new idempotency key) can be created.
        const cleared = {
          ...prevMeta,
          stripeRefundId: null,
          stripeRefundAmountMinor: retrieved.amountMinor,
          stripeRefundCurrency: retrieved.currency,
          stripeRefundStatus: retrieved.status,
          stripeRefundStaleCleared: existingId,
          ledgerCurrency: 'USD',
        };
        await this.prisma.order.update({
          where: { id: order.id },
          data: { meta: cleared as any },
        });
        prevMeta = cleared;
        order.meta = cleared;
        // fall through to create
      } else {
        await this.assertFullRefundOrThrow({
          amountMinor: retrieved.amountMinor,
          orderAmountMinor: amountMinor,
          status: retrieved.status,
          refundId: retrieved.refundId,
          currency: retrieved.currency,
          prevMeta,
          orderId: order.id,
        });
        await this.prisma.order.update({
          where: { id: order.id },
          data: {
            meta: {
              ...prevMeta,
              stripeRefundId: retrieved.refundId,
              stripeRefundAmountMinor: retrieved.amountMinor,
              stripeRefundCurrency: retrieved.currency,
              stripeRefundStatus: retrieved.status,
              ledgerCurrency: 'USD',
            } as any,
          },
        });
        return {
          refundId: retrieved.refundId,
          alreadyRefunded: retrieved.alreadyRefunded,
          amountMinor: retrieved.amountMinor,
          currency: retrieved.currency,
          status: retrieved.status,
        };
      }
    }

    const paymentRef = String(order.externalRef || prevMeta.stripePaymentIntentId || '').trim();
    if (!paymentRef) {
      throw new BizException(BizCode.BAD_REQUEST, 'stripe.refundMissingPaymentRef');
    }

    // First attempt keeps stable key; retries after failed/canceled use a fresh key.
    const attempt = Number(prevMeta.stripeRefundAttempt || 0) || 0;
    const nextAttempt = attempt + 1;
    const staleCleared = !!prevMeta.stripeRefundStaleCleared;
    const idempotencyKey =
      staleCleared || nextAttempt > 1
        ? `velvet-refund:${order.orderNo}:a${nextAttempt}`
        : `velvet-refund:${order.orderNo}`;
    const stripe = await createStripeRefund({
      paymentIntentOrChargeId: paymentRef,
      amountMinor: Number.isFinite(amountMinor) && amountMinor > 0 ? amountMinor : undefined,
      idempotencyKey,
      metadata: { orderNo: order.orderNo, order_no: order.orderNo },
      fetchImpl: opts?.fetchImpl,
    });

    const metaAfter = {
      ...prevMeta,
      stripeRefundId: stripe.refundId,
      stripeRefundAmountMinor: stripe.amountMinor,
      stripeRefundCurrency: stripe.currency,
      stripeRefundStatus: stripe.status,
      stripeRefundAttempt: nextAttempt,
      ledgerCurrency: 'USD',
    };

    // Partial Stripe refunds are not supported for local entitlement revoke.
    if (
      !isFullStripeRefund({
        refundAmountMinor: stripe.amountMinor,
        orderAmountMinor: amountMinor,
      }) &&
      stripe.amountMinor > 0 &&
      Number.isFinite(amountMinor) &&
      amountMinor > 0
    ) {
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          meta: {
            ...metaAfter,
            partialRefundPending: true,
          } as any,
        },
      });
      throw new BizException(BizCode.CONFLICT, 'stripe.partialRefundUnsupported');
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { meta: metaAfter as any },
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
      throw new BizException(BizCode.CONFLICT, 'order.alreadyRefundedOrPending');
    }
    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: { refundStatus: 'REQUESTED', refundNote: note || null },
    });
    return { orderNo: updated.orderNo, refundStatus: updated.refundStatus };
  }

  async approve(orderNo: string, actorId?: bigint, opts?: { fetchImpl?: typeof fetch }) {
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
      throw new BizException(BizCode.ORDER_NOT_PAID, 'order.unpaidCannotCompleteRefund');
    }

    // Stripe real-money refund first; local credits/VIP revoke only after succeeded.
    const providerRefund = await this.ensureProviderRefund(order, opts);
    if (
      providerRefund &&
      !isStripeRefundSucceeded(providerRefund.status)
    ) {
      await this.audit.write({
        actorId,
        action: 'order.refund.pending_provider',
        targetType: 'order',
        targetId: orderNo,
        payload: {
          orderType: order.orderType,
          stripeRefundId: providerRefund.refundId,
          stripeRefundStatus: providerRefund.status,
        },
      });
      return {
        refunded: false,
        alreadyRefunded: false,
        pendingProvider: true,
        orderNo,
        stripeRefundId: providerRefund.refundId,
        stripeRefundStatus: providerRefund.status,
      };
    }

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
      throw new BizException(BizCode.FORBIDDEN, 'order.typeNoRefund');
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
        stripeRefundStatus: providerRefund?.status ?? null,
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

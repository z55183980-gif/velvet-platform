import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { PAYMENT_PROVIDERS, ParsedWebhook } from './provider.interface';
import { BizException, BizCode } from '../common/biz.exception';
import { StructuredLogger } from '../common/structured-logger.service';
import { safeEqualString } from '../common/security-config';
import {
  loadStripeGatewayConfig,
  parseStripeWebhookPayload,
  resolveStripeWebhookSecrets,
  verifyStripeSignature,
} from './stripe-gateway.runtime';

/** provider 路径参数 → Order.paymentMethod */
const PROVIDER_TO_METHOD: Record<string, string> = {
  stripe: 'STRIPE',
  wechat: 'WECHAT',
  alipay: 'ALIPAY',
  momo: 'MOMO',
  zalopay: 'ZALOPAY',
  vietqr: 'VIETQR',
  bank_transfer: 'BANK_TRANSFER',
  bank: 'BANK_TRANSFER',
};

const PAID_STATUSES = new Set(['paid', 'success', 'trade_success', 'completed']);

/** Stripe event types that indicate a successful payment for order credit. */
const STRIPE_PAID_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'invoice.payment_succeeded',
  'invoice_payment.paid',
  'payment_intent.succeeded',
  'charge.succeeded',
]);

const STRIPE_REFUND_EVENT_TYPES = new Set([
  'charge.refunded',
  'refund.updated',
  'charge.refund.updated',
]);

export type WebhookAuthContext = {
  stripeSignature?: string;
  webhookSecret?: string;
  rawBody?: Buffer;
};

@Injectable()
export class PaymentsService {
  private readonly sharedWebhookSecret: string;

  constructor(
    private readonly wallet: WalletService,
    private readonly prisma: PrismaService,
    private readonly log: StructuredLogger,
    config: ConfigService,
  ) {
    this.sharedWebhookSecret =
      config.get<string>('WEBHOOK_SECRET') ||
      (process.env.NODE_ENV === 'production' ? '' : 'dev-webhook');
  }

  /**
   * Shared-key auth for non-Stripe channels.
   * Prefer live `process.env.WEBHOOK_SECRET` so admin/env updates apply without restart
   * on the current worker; fall back to boot-time value.
   */
  private sharedSecret(): string {
    return (process.env.WEBHOOK_SECRET || '').trim() || this.sharedWebhookSecret;
  }

  assertWebhookAuth(provider: string, secretHeader?: string) {
    const secret = this.sharedSecret();
    if (!secret) {
      this.log.warn({
        event: 'webhook.auth.missing_secret',
        provider,
      });
      throw new BizException(
        BizCode.FORBIDDEN,
        'Webhook secret not configured',
      );
    }
    if (!secretHeader || !safeEqualString(secretHeader, secret)) {
      this.log.warn({
        event: 'webhook.auth.invalid',
        provider,
        hasSecret: !!secretHeader,
      });
      throw new BizException(BizCode.UNAUTHORIZED, 'Invalid webhook signature');
    }
  }

  private isProduction(): boolean {
    const env = (process.env.NODE_ENV || '').trim().toLowerCase();
    return env === 'production';
  }

  private async assertStripeWebhookAuth(ctx: WebhookAuthContext, storeSecret: string) {
    const secrets = resolveStripeWebhookSecrets(storeSecret);
    if (!secrets.length) {
      this.log.warn({ event: 'webhook.auth.missing_secret', provider: 'stripe' });
      throw new BizException(BizCode.FORBIDDEN, 'Stripe webhook secret not configured');
    }

    const sig = (ctx.stripeSignature || '').trim();
    if (sig) {
      if (!ctx.rawBody?.length) {
        this.log.warn({
          event: 'webhook.auth.invalid',
          provider: 'stripe',
          mode: 'missing_raw_body',
        });
        throw new BizException(
          BizCode.BAD_REQUEST,
          'Stripe-Signature present but raw body unavailable for verification',
        );
      }
      if (!verifyStripeSignature(ctx.rawBody, sig, secrets)) {
        this.log.warn({
          event: 'webhook.auth.invalid',
          provider: 'stripe',
          mode: 'stripe_signature',
          hasSecret: true,
        });
        throw new BizException(BizCode.UNAUTHORIZED, 'Invalid Stripe webhook signature');
      }
      return;
    }

    // Shared-secret fallback is for local/dev only. Production Stripe must send Stripe-Signature.
    if (this.isProduction()) {
      this.log.warn({
        event: 'webhook.auth.invalid',
        provider: 'stripe',
        mode: 'missing_stripe_signature',
      });
      throw new BizException(BizCode.UNAUTHORIZED, 'Stripe-Signature header required');
    }

    const header = (ctx.webhookSecret || '').trim();
    const legacy = this.sharedSecret();
    const accepted = [...secrets];
    if (legacy && !accepted.includes(legacy)) accepted.push(legacy);
    if (!header || !accepted.includes(header)) {
      this.log.warn({
        event: 'webhook.auth.invalid',
        provider: 'stripe',
        mode: 'shared_secret',
        hasSecret: !!header,
      });
      throw new BizException(BizCode.UNAUTHORIZED, 'Invalid webhook signature');
    }
  }

  /** 处理渠道回调（幂等：eventId 去重 + creditOnPaid 内部防重） */
  async handleWebhook(provider: string, payload: any, ctx: WebhookAuthContext = {}) {
    const providerKey = String(provider || '').toLowerCase();
    const t0 = Date.now();

    if (providerKey === 'stripe') {
      return this.handleStripeWebhook(payload, ctx, t0);
    }

    this.assertWebhookAuth(providerKey, ctx.webhookSecret || ctx.stripeSignature);

    const eventId =
      payload?.id ||
      payload?.event_id ||
      payload?.eventId ||
      payload?.notify_id ||
      payload?.notifyId ||
      null;

    try {
      return await this.creditFromWebhook(providerKey, payload, eventId, t0);
    } catch (e: any) {
      this.log.error({
        event: 'webhook.failed',
        provider: providerKey,
        eventId,
        latencyMs: Date.now() - t0,
        message: e?.message || String(e),
        bizCode: e?.bizCode,
      });
      throw e;
    }
  }

  private async handleStripeWebhook(payload: any, ctx: WebhookAuthContext, t0: number) {
    const gateway = await loadStripeGatewayConfig(this.prisma);
    await this.assertStripeWebhookAuth(ctx, gateway.webhook_signing_secret);

    const parsedStripe = parseStripeWebhookPayload(payload);
    const eventId = parsedStripe.eventId;
    const eventType = parsedStripe.eventType;

    // Match zai: after signature ok, honor admin enable + event allowlist.
    if (gateway.enabled === false && String(gateway.webhook_endpoint_url || '').trim()) {
      this.log.log({
        event: 'webhook.skipped',
        provider: 'stripe',
        reason: 'gateway_disabled',
        eventId,
        eventType,
        latencyMs: Date.now() - t0,
      });
      return { received: true, skipped: true, gateway_disabled: true };
    }
    if (gateway.enabled_events?.length) {
      if (!eventType || !gateway.enabled_events.includes(eventType)) {
        this.log.log({
          event: 'webhook.skipped',
          provider: 'stripe',
          reason: 'event_disabled',
          eventId,
          eventType,
          latencyMs: Date.now() - t0,
        });
        return { received: true, skipped: true, event_disabled: true };
      }
    }

    try {
      if (eventId) {
        const existed = await this.prisma.webhookEvent.findUnique({
          where: { provider_eventId: { provider: 'stripe', eventId: String(eventId) } },
        });
        if (existed) {
          this.log.log({
            event: 'webhook.replay.ignored',
            provider: 'stripe',
            eventId: String(eventId),
            orderNo: existed.orderNo,
            latencyMs: Date.now() - t0,
          });
          return { received: true, duplicate: true, eventId: String(eventId) };
        }
      }

      const isRefund = !!(eventType && STRIPE_REFUND_EVENT_TYPES.has(eventType));

      // Non-payment / non-creditable event types: acknowledge after allowlist check.
      if (
        eventType &&
        !STRIPE_PAID_EVENT_TYPES.has(eventType) &&
        !isRefund &&
        !payload?.orderNo
      ) {
        this.log.log({
          event: 'webhook.parse.ignored',
          provider: 'stripe',
          eventId,
          eventType,
          reason: 'non_paid_event',
          latencyMs: Date.now() - t0,
        });
        return { received: true, ignored: true, reason: 'non_paid_event' };
      }

      if (!parsedStripe.orderNo) {
        this.log.log({
          event: 'webhook.parse.ignored',
          provider: 'stripe',
          eventId,
          eventType,
          reason: 'no_orderNo',
          latencyMs: Date.now() - t0,
        });
        return { received: true, ignored: true };
      }

      if (isRefund) {
        const refundStatus = String(
          payload?.data?.object?.status || payload?.status || '',
        ).toLowerCase();
        if (
          eventType === 'refund.updated' &&
          refundStatus &&
          refundStatus !== 'succeeded' &&
          refundStatus !== 'paid'
        ) {
          return { received: true, ignored: true, reason: 'refund_not_succeeded' };
        }
        const result = await this.wallet.revokeOnProviderRefund(
          parsedStripe.orderNo,
          `Stripe ${eventType}`,
        );
        if (eventId) {
          try {
            await this.prisma.webhookEvent.create({
              data: {
                provider: 'stripe',
                eventId: String(eventId),
                orderNo: parsedStripe.orderNo,
                payload: payload as any,
              },
            });
          } catch (e: any) {
            if (e?.code === 'P2002') {
              return { received: true, duplicate: true, eventId: String(eventId) };
            }
            throw e;
          }
        }
        this.log.log({
          event: 'webhook.refund.handled',
          provider: 'stripe',
          orderNo: parsedStripe.orderNo,
          eventId,
          eventType,
          latencyMs: Date.now() - t0,
        });
        return { received: true, ...result };
      }

      const status = String(payload?.status || payload?.trade_status || 'paid').toLowerCase();
      if (payload?.orderNo && !PAID_STATUSES.has(status)) {
        this.log.log({
          event: 'webhook.parse.ignored',
          provider: 'stripe',
          orderNo: parsedStripe.orderNo,
          reason: `status=${status}`,
        });
        return { received: true, ignored: true, reason: 'status_not_paid' };
      }

      // Stripe Checkout may leave payment_status unpaid on some event edges.
      const paymentStatus = String(payload?.data?.object?.payment_status || '').toLowerCase();
      if (paymentStatus && paymentStatus !== 'paid' && eventType === 'checkout.session.completed') {
        this.log.log({
          event: 'webhook.parse.ignored',
          provider: 'stripe',
          orderNo: parsedStripe.orderNo,
          reason: `payment_status=${paymentStatus}`,
        });
        return { received: true, ignored: true, reason: 'payment_status_not_paid' };
      }

      await this.assertProviderMatchesOrder('stripe', parsedStripe.orderNo);
      // Do not overwrite order.payAmount from Stripe minor-unit fields.
      // Flat dev payloads may still carry major-unit payAmount.
      const result = await this.wallet.creditOnPaid(parsedStripe.orderNo, {
        externalRef: parsedStripe.externalRef,
        currency: parsedStripe.currency,
        ...(parsedStripe.fromFlatPayload && parsedStripe.payAmountMajor != null
          ? { payAmount: parsedStripe.payAmountMajor }
          : {}),
      });

      if (eventId) {
        try {
          await this.prisma.webhookEvent.create({
            data: {
              provider: 'stripe',
              eventId: String(eventId),
              orderNo: parsedStripe.orderNo,
              payload: payload as any,
            },
          });
        } catch (e: any) {
          if (e?.code === 'P2002') {
            this.log.log({
              event: 'webhook.replay.ignored',
              provider: 'stripe',
              eventId: String(eventId),
              orderNo: parsedStripe.orderNo,
              latencyMs: Date.now() - t0,
            });
            return { received: true, duplicate: true, eventId: String(eventId) };
          }
          throw e;
        }
      }

      this.log.log({
        event: 'webhook.handled',
        provider: 'stripe',
        orderNo: parsedStripe.orderNo,
        eventId,
        eventType,
        latencyMs: Date.now() - t0,
        alreadyPaid: (result as any)?.alreadyPaid ?? false,
      });
      return { received: true, ...result };
    } catch (e: any) {
      this.log.error({
        event: 'webhook.failed',
        provider: 'stripe',
        eventId,
        eventType,
        latencyMs: Date.now() - t0,
        message: e?.message || String(e),
        bizCode: e?.bizCode,
      });
      throw e;
    }
  }

  private async creditFromWebhook(
    provider: string,
    payload: any,
    eventId: string | null,
    t0: number,
  ) {
    if (eventId) {
      const existed = await this.prisma.webhookEvent.findUnique({
        where: { provider_eventId: { provider, eventId: String(eventId) } },
      });
      if (existed) {
        this.log.log({
          event: 'webhook.replay.ignored',
          provider,
          eventId: String(eventId),
          orderNo: existed.orderNo,
          latencyMs: Date.now() - t0,
        });
        return { received: true, duplicate: true, eventId: String(eventId) };
      }
    }

    const p = PAYMENT_PROVIDERS[provider];
    if (!p) {
      this.log.warn({ event: 'webhook.provider.unknown', provider });
      throw new BizException(BizCode.BAD_REQUEST, 'Kênh thanh toán không hỗ trợ');
    }
    const parsed: ParsedWebhook | null = p.parse(payload);
    if (!parsed) {
      this.log.log({ event: 'webhook.parse.ignored', provider, reason: 'no_orderNo' });
      return { received: true, ignored: true };
    }
    const status = String(payload?.status || payload?.trade_status || 'paid').toLowerCase();
    if (!PAID_STATUSES.has(status)) {
      this.log.log({
        event: 'webhook.parse.ignored',
        provider,
        orderNo: parsed.orderNo,
        reason: `status=${status}`,
      });
      return { received: true, ignored: true, reason: 'status_not_paid' };
    }

    await this.assertProviderMatchesOrder(provider, parsed.orderNo);
    const result = await this.wallet.creditOnPaid(parsed.orderNo, {
      externalRef: parsed.externalRef,
      payAmount: parsed.payAmount,
      currency: parsed.currency,
    });

    if (eventId) {
      try {
        await this.prisma.webhookEvent.create({
          data: {
            provider,
            eventId: String(eventId),
            orderNo: parsed.orderNo,
            payload: payload as any,
          },
        });
      } catch (e: any) {
        if (e?.code === 'P2002') {
          this.log.log({
            event: 'webhook.replay.ignored',
            provider,
            eventId: String(eventId),
            orderNo: parsed.orderNo,
            latencyMs: Date.now() - t0,
          });
          return { received: true, duplicate: true, eventId: String(eventId) };
        }
        throw e;
      }
    }

    this.log.log({
      event: 'webhook.handled',
      provider,
      orderNo: parsed.orderNo,
      eventId,
      latencyMs: Date.now() - t0,
      alreadyPaid: (result as any)?.alreadyPaid ?? false,
    });
    return { received: true, ...result };
  }

  /** 开发态模拟支付成功（替代真实渠道 webhook） */
  async simulate(orderNo: string) {
    if (process.env.NODE_ENV === 'production') {
      throw new BizException(BizCode.FORBIDDEN, 'Simulate disabled in production');
    }
    this.log.log({ event: 'payments.simulate', orderNo });
    return this.wallet.creditOnPaid(orderNo);
  }

  /** 可用支付渠道（按区域）。开源版不展示具体渠道 SDK 就绪状态。 */
  getPaymentMethods(region = 'VN') {
    const all = [
      { method: 'MOMO', label: 'MoMo', region: 'VN' },
      { method: 'ZALOPAY', label: 'ZaloPay', region: 'VN' },
      { method: 'VIETQR', label: 'VietQR', region: 'VN' },
      { method: 'BANK_TRANSFER', label: 'Chuyển khoản ngân hàng', region: 'VN' },
      { method: 'STRIPE', label: 'Thẻ quốc tế (Stripe)', region: 'VN' },
      { method: 'WECHAT', label: '微信支付', region: 'CN' },
      { method: 'ALIPAY', label: '支付宝', region: 'CN' },
    ];
    if (process.env.NODE_ENV !== 'production') {
      all.push({ method: 'SIMULATE', label: '模拟支付 (dev)', region } as any);
    }
    return all.filter((m) => m.region === region || (m as any).method === 'SIMULATE');
  }

  private async assertProviderMatchesOrder(provider: string, orderNo: string) {
    const order = await this.prisma.order.findUnique({ where: { orderNo } });
    if (!order) {
      this.log.warn({ event: 'webhook.order.missing', provider, orderNo });
      throw new BizException(BizCode.NOT_FOUND, 'order.notFound');
    }
    if (order.paymentStatus === 'REFUNDED') {
      this.log.warn({
        event: 'webhook.order.refunded',
        provider,
        orderNo,
        status: order.paymentStatus,
      });
      throw new BizException(BizCode.CONFLICT, 'order.alreadyRefundedCannotMarkPaid');
    }
    const expected = PROVIDER_TO_METHOD[provider.toLowerCase()];
    if (!expected) return;
    const method = String(order.paymentMethod || '').toUpperCase();
    if (method === 'SIMULATE' || method === 'WALLET') {
      this.log.warn({
        event: 'webhook.order.method_mismatch',
        provider,
        orderNo,
        method,
      });
      throw new BizException(
        BizCode.FORBIDDEN,
        `Đơn hàng paymentMethod=${method} không chấp nhận webhook ${provider}`,
      );
    }
    if (method && method !== expected) {
      this.log.warn({
        event: 'webhook.order.method_mismatch',
        provider,
        orderNo,
        method,
        expected,
      });
      throw new BizException(
        BizCode.FORBIDDEN,
        `Provider ${provider} không khớp paymentMethod=${method}`,
      );
    }
  }
}

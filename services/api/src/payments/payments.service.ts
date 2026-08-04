import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { PAYMENT_PROVIDERS, ParsedWebhook } from './provider.interface';
import { BizException, BizCode } from '../common/biz.exception';
import { StructuredLogger } from '../common/structured-logger.service';

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

@Injectable()
export class PaymentsService {
  private readonly webhookSecret: string;

  constructor(
    private readonly wallet: WalletService,
    private readonly prisma: PrismaService,
    private readonly log: StructuredLogger,
    config: ConfigService,
  ) {
    this.webhookSecret =
      config.get<string>('WEBHOOK_SECRET') ||
      (process.env.NODE_ENV === 'production' ? '' : 'dev-webhook');
  }

  /**
   * 校验非 alipay webhook 的共享密钥。
   * 生产：必须配置 WEBHOOK_SECRET 且 header 匹配。
   * 非生产：默认密钥 `dev-webhook`（可用 WEBHOOK_SECRET 覆盖）。
   */
  assertWebhookAuth(provider: string, secretHeader?: string) {
    if (!this.webhookSecret) {
      this.log.warn({
        event: 'webhook.auth.missing_secret',
        provider,
      });
      throw new BizException(
        BizCode.FORBIDDEN,
        'Webhook secret not configured',
      );
    }
    if (!secretHeader || secretHeader !== this.webhookSecret) {
      this.log.warn({
        event: 'webhook.auth.invalid',
        provider,
        hasSecret: !!secretHeader,
      });
      throw new BizException(BizCode.UNAUTHORIZED, 'Invalid webhook signature');
    }
  }

  /** 处理渠道回调（幂等：eventId 去重 + creditOnPaid 内部防重） */
  async handleWebhook(provider: string, payload: any) {
    const t0 = Date.now();
    const eventId =
      payload?.id ||
      payload?.event_id ||
      payload?.eventId ||
      payload?.notify_id ||
      payload?.notifyId ||
      null;

    try {
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
      if (!['paid', 'success', 'trade_success', 'completed'].includes(status)) {
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
          // 并发重放：唯一约束冲突 → 视为已处理
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
    } catch (e: any) {
      this.log.error({
        event: 'webhook.failed',
        provider,
        eventId,
        latencyMs: Date.now() - t0,
        message: e?.message || String(e),
        bizCode: e?.bizCode,
      });
      throw e;
    }
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

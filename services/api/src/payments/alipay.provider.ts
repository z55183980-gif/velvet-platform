import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentProvider, ParsedWebhook } from './provider.interface';

/**
 * ⚠️ 支付渠道占位实现（开源版）
 *
 * 商业部署时请使用你自己的支付渠道 SDK（alipay-sdk / wechatpay-node-v3 / stripe …），
 * 并补齐签名校验、金额核对、退款、查询等环节。
 *
 * 这里仅保留 Provider 接口与「未就绪」状态位，避免泄露任何凭据相关逻辑。
 */
@Injectable()
export class AlipayProvider implements PaymentProvider {
  readonly name = 'alipay';
  private readonly logger = new Logger(AlipayProvider.name);

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    const v = this.config.get<string>('ALIPAY_ENABLED');
    return v === '1' || v === 'true';
  }

  isReady(): boolean {
    // 开源版不内置具体渠道 SDK，避免依赖与凭据问题。
    // 接入时把这里替换成真实证书/密钥的就绪判断。
    return false;
  }

  parse(payload: any): ParsedWebhook | null {
    if (!payload) return null;
    const orderNo = payload.out_trade_no || payload.orderNo;
    if (!orderNo) return null;
    // 开源版不做签名校验；接入时务必在此处完成验签 + 金额核对。
    return {
      orderNo: String(orderNo),
      externalRef: payload.trade_no ? String(payload.trade_no) : undefined,
      payAmount: payload.total_amount != null ? String(payload.total_amount) : undefined,
      currency: 'CNY',
    };
  }

  /** 占位：返回 false，提示接入方替换为真实实现 */
  verifyNotify(_postData: Record<string, any>): boolean {
    this.logger.warn(
      'AlipayProvider.verifyNotify is a no-op stub in the open-source build. ' +
        'Wire your real signing verification before going to production.',
    );
    return false;
  }
}

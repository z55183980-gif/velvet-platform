export interface ParsedWebhook {
  orderNo: string;
  externalRef?: string;
  payAmount?: string;
  currency?: string;
}

/**
 * 支付渠道抽象。MVP 各渠道以「解析 + 标记已付」的最小实现存在，
 * 真实接入时在此处替换签名校验、金额核对与渠道特定字段解析。
 */
export interface PaymentProvider {
  name: string;
  /** 从渠道回调体中解析出我们的订单号；校验失败返回 null */
  parse(payload: any): ParsedWebhook | null;
}

class BaseProvider implements PaymentProvider {
  constructor(public readonly name: string) {}
  // 开发态约定：回调体携带我们下发的 orderNo；生产需按渠道文档解析并验签
  parse(payload: any): ParsedWebhook | null {
    if (!payload || !payload.orderNo) return null;
    return {
      orderNo: String(payload.orderNo),
      externalRef: payload.externalRef ? String(payload.externalRef) : undefined,
      payAmount: payload.payAmount != null ? String(payload.payAmount) : undefined,
      currency: payload.currency ? String(payload.currency) : undefined,
    };
  }
}

export const PAYMENT_PROVIDERS: Record<string, PaymentProvider> = {
  stripe: new BaseProvider('stripe'),
  wechat: new BaseProvider('wechat'),
  alipay: new BaseProvider('alipay'),
  momo: new BaseProvider('momo'),
  zalopay: new BaseProvider('zalopay'),
  vietqr: new BaseProvider('vietqr'),
};

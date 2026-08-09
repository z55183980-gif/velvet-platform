import { HttpStatus } from '@nestjs/common';
import { BizException, BizCode } from '../common/biz.exception';

function formEncode(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

function secretKey(): string {
  const key = (process.env.STRIPE_SECRET_KEY || '').trim();
  if (!key || key.startsWith('CHANGE_ME')) {
    throw new BizException(
      BizCode.BAD_REQUEST,
      'Payment is not configured',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
  return key;
}

export type StripeRefundInput = {
  /** Stripe PaymentIntent id (pi_…) or Charge id (ch_…) */
  paymentIntentOrChargeId: string;
  /** USD cents (or charge currency minor units) */
  amountMinor?: number;
  idempotencyKey: string;
  metadata?: Record<string, string>;
  /** Injected fetch for tests */
  fetchImpl?: typeof fetch;
};

export type StripeRefundResult = {
  refundId: string;
  status: string;
  amountMinor: number;
  currency: string;
  alreadyRefunded: boolean;
};

/** Stripe terminal success statuses for Refund objects. */
export function isStripeRefundSucceeded(status: string | null | undefined): boolean {
  const s = String(status || '')
    .trim()
    .toLowerCase();
  return s === 'succeeded' || s === 'paid';
}

/**
 * Retrieve an existing Stripe Refund by id (re_…).
 * Used to verify historical meta.stripeRefundId instead of assuming success.
 */
export async function retrieveStripeRefund(opts: {
  refundId: string;
  fetchImpl?: typeof fetch;
}): Promise<StripeRefundResult> {
  const refundId = String(opts.refundId || '').trim();
  if (!refundId.startsWith('re_')) {
    throw new BizException(BizCode.BAD_REQUEST, 'stripe.refundInvalidId');
  }
  const fetchFn = opts.fetchImpl || fetch;
  const res = await fetchFn(
    `https://api.stripe.com/v1/refunds/${encodeURIComponent(refundId)}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${secretKey()}` },
    },
  );
  const json = (await res.json().catch(() => null)) as Record<string, any> | null;
  if (!res.ok) {
    const message = String(json?.error?.message || '').trim();
    throw new BizException(
      BizCode.BAD_REQUEST,
      message || `Stripe refund retrieve failed (${res.status})`,
    );
  }
  return {
    refundId: String(json?.id || refundId),
    status: String(json?.status || 'unknown'),
    amountMinor: Number(json?.amount) || 0,
    currency: String(json?.currency || 'usd').toLowerCase(),
    alreadyRefunded: isStripeRefundSucceeded(String(json?.status || '')),
  };
}

/**
 * Create a Stripe Refund (test-mode or live). Idempotent via Idempotency-Key.
 * Does not mutate local wallet — caller runs the local saga only after succeeded.
 */
export async function createStripeRefund(input: StripeRefundInput): Promise<StripeRefundResult> {
  const ref = String(input.paymentIntentOrChargeId || '').trim();
  if (!ref) {
    throw new BizException(BizCode.BAD_REQUEST, 'stripe.refundMissingPaymentRef');
  }

  const body: Record<string, string> = {};
  if (ref.startsWith('pi_')) body.payment_intent = ref;
  else if (ref.startsWith('ch_')) body.charge = ref;
  else body.payment_intent = ref;

  if (input.amountMinor != null) {
    const n = Math.floor(Number(input.amountMinor));
    if (!Number.isFinite(n) || n <= 0) {
      throw new BizException(BizCode.BAD_REQUEST, 'stripe.refundInvalidAmount');
    }
    body.amount = String(n);
  }
  if (input.metadata) {
    for (const [k, v] of Object.entries(input.metadata)) {
      body[`metadata[${k}]`] = String(v).slice(0, 500);
    }
  }

  const fetchFn = input.fetchImpl || fetch;
  const res = await fetchFn('https://api.stripe.com/v1/refunds', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': input.idempotencyKey.slice(0, 255),
    },
    body: formEncode(body),
  });

  const json = (await res.json().catch(() => null)) as Record<string, any> | null;
  if (!res.ok) {
    const code = String(json?.error?.code || '');
    const message = String(json?.error?.message || '').trim();
    // Idempotent / already fully refunded on Stripe side
    if (
      code === 'charge_already_refunded' ||
      /already been refunded/i.test(message)
    ) {
      return {
        refundId: String(json?.error?.charge || ref),
        status: 'succeeded',
        amountMinor: input.amountMinor ?? 0,
        currency: 'usd',
        alreadyRefunded: true,
      };
    }
    throw new BizException(
      BizCode.BAD_REQUEST,
      message || `Stripe refund failed (${res.status})`,
    );
  }

  const refundId = String(json?.id || '').trim();
  if (!refundId) {
    throw new BizException(BizCode.BAD_REQUEST, 'stripe.refundMissingId', HttpStatus.BAD_GATEWAY);
  }
  return {
    refundId,
    status: String(json?.status || 'unknown'),
    amountMinor: Number(json?.amount) || 0,
    currency: String(json?.currency || 'usd').toLowerCase(),
    alreadyRefunded: false,
  };
}

/** True when Stripe refund covers the full charge / order minor amount. */
export function isFullStripeRefund(opts: {
  refundAmountMinor?: number | null;
  amountRefundedMinor?: number | null;
  chargeAmountMinor?: number | null;
  orderAmountMinor?: number | null;
}): boolean {
  const order = opts.orderAmountMinor != null ? Number(opts.orderAmountMinor) : null;
  const charge = opts.chargeAmountMinor != null ? Number(opts.chargeAmountMinor) : null;
  const target = charge != null && charge > 0 ? charge : order;
  if (target == null || !Number.isFinite(target) || target <= 0) {
    // Without amounts, treat as full only when amount_refunded is absent (legacy flat payloads).
    return opts.amountRefundedMinor == null && opts.refundAmountMinor == null;
  }
  const refunded =
    opts.amountRefundedMinor != null
      ? Number(opts.amountRefundedMinor)
      : opts.refundAmountMinor != null
        ? Number(opts.refundAmountMinor)
        : null;
  if (refunded == null || !Number.isFinite(refunded)) return false;
  return refunded >= target;
}

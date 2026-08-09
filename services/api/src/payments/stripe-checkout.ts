import { HttpStatus } from '@nestjs/common';
import { BizException, BizCode } from '../common/biz.exception';
import { PrismaService } from '../prisma/prisma.service';
import { loadStripeGatewayConfig } from './stripe-gateway.runtime';

const CHECKOUT_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function paymentNotConfigured(): never {
  throw new BizException(
    BizCode.BAD_REQUEST,
    'Payment is not configured',
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

export type StripeCheckoutInput = {
  orderNo: string;
  userId: bigint;
  /** Product label shown on Stripe Checkout */
  productName: string;
  /** Major currency units, e.g. 9.99 USD */
  payAmountMajor: string | number;
  currency: string;
  customerEmail?: string | null;
  metadata?: Record<string, string>;
};

export type StripeCheckoutResult = {
  checkoutUrl: string;
  sessionId: string;
};

function secretKey(): string {
  const key = (process.env.STRIPE_SECRET_KEY || '').trim();
  if (!key || key.startsWith('CHANGE_ME')) paymentNotConfigured();
  return key;
}

function checkoutReturnUrls() {
  const frontendBase = (
    process.env.WEB_BASE_URL ||
    process.env.FRONTEND_PUBLIC_URL ||
    'http://localhost:3000'
  )
    .trim()
    .replace(/\/+$/, '');
  let success = (process.env.SUBSCRIPTION_SUCCESS_URL || process.env.VIP_SUCCESS_URL || '').trim();
  let cancel = (process.env.SUBSCRIPTION_CANCEL_URL || process.env.VIP_CANCEL_URL || '').trim();
  if (!success) success = `${frontendBase}/wallet/result?status=success`;
  if (!cancel) cancel = `${frontendBase}/wallet/result?status=cancel`;
  return { success_url: success, cancel_url: cancel };
}

function checkoutEmail(userId: bigint, email?: string | null): string {
  const trimmed = String(email || '').trim();
  if (CHECKOUT_EMAIL_RE.test(trimmed)) return trimmed;
  return `u${userId.toString()}@checkout.velvet.local`;
}

function toMinorUnits(payAmountMajor: string | number, currency: string): number {
  const n = typeof payAmountMajor === 'number' ? payAmountMajor : Number(payAmountMajor);
  if (!Number.isFinite(n) || n <= 0) {
    throw new BizException(BizCode.BAD_REQUEST, 'Invalid payment amount');
  }
  // Stripe zero-decimal currencies are rare for Velvet (USD); always use cents for USD.
  const zeroDecimal = new Set(['JPY', 'KRW', 'VND']);
  if (zeroDecimal.has(currency.toUpperCase())) {
    return Math.round(n);
  }
  return Math.round(n * 100);
}

function formEncode(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/**
 * Whether admin gateway + env are ready to create Checkout sessions.
 * Does not require webhook secret (create can work before webhook is wired),
 * but mirrors zai's "enabled + secret key" gate for charging.
 */
export async function isStripeCheckoutReady(prisma: PrismaService): Promise<boolean> {
  const gateway = await loadStripeGatewayConfig(prisma);
  if (!gateway.enabled) return false;
  const key = (process.env.STRIPE_SECRET_KEY || '').trim();
  return Boolean(key && !key.startsWith('CHANGE_ME'));
}

/**
 * Create a one-time Stripe Checkout Session (same Stripe account as zai via STRIPE_SECRET_KEY).
 * Uses mode=payment + price_data so Velvet packages/VIP plans need no stripe_price_id.
 * VIP is NOT a Stripe Subscription: storefront copy must say one-time / no auto-renewal.
 */
export async function createStripeCheckoutSession(
  prisma: PrismaService,
  input: StripeCheckoutInput,
): Promise<StripeCheckoutResult> {
  const ready = await isStripeCheckoutReady(prisma);
  if (!ready) paymentNotConfigured();

  const currency = (input.currency || 'USD').trim().toLowerCase();
  const amount = toMinorUnits(input.payAmountMajor, currency.toUpperCase());
  const urls = checkoutReturnUrls();
  const meta: Record<string, string> = {
    orderNo: input.orderNo,
    order_no: input.orderNo,
    user_id: input.userId.toString(),
    ...(input.metadata || {}),
  };

  const body: Record<string, string> = {
    mode: 'payment',
    success_url: urls.success_url,
    cancel_url: urls.cancel_url,
    client_reference_id: input.orderNo,
    customer_email: checkoutEmail(input.userId, input.customerEmail),
    // New Stripe accounts may enable Managed Payments by default, which requires
    // product tax codes. Velvet uses classic one-time Checkout only.
    'managed_payments[enabled]': 'false',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': currency,
    'line_items[0][price_data][unit_amount]': String(amount),
    'line_items[0][price_data][product_data][name]': input.productName.slice(0, 120) || 'Velvet order',
    'payment_intent_data[metadata][orderNo]': input.orderNo,
    'payment_intent_data[metadata][order_no]': input.orderNo,
  };
  for (const [k, v] of Object.entries(meta)) {
    body[`metadata[${k}]`] = String(v).slice(0, 500);
  }

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': input.orderNo,
    },
    body: formEncode(body),
  });

  const json = (await res.json().catch(() => null)) as Record<string, any> | null;
  if (!res.ok) {
    const message =
      String(json?.error?.message || json?.error?.code || '').trim() ||
      `Stripe checkout failed (${res.status})`;
    throw new BizException(BizCode.BAD_REQUEST, message);
  }

  const checkoutUrl = String(json?.url || '').trim();
  const sessionId = String(json?.id || '').trim();
  if (!checkoutUrl || !sessionId) {
    throw new BizException(
      BizCode.BAD_REQUEST,
      'Checkout session has no URL',
      HttpStatus.BAD_GATEWAY,
    );
  }
  return { checkoutUrl, sessionId };
}

/** Retrieve an open Checkout Session URL; null if missing/expired/unusable. */
export async function retrieveStripeCheckoutSession(
  sessionId: string,
): Promise<StripeCheckoutResult | null> {
  const id = String(sessionId || '').trim();
  if (!id.startsWith('cs_')) return null;
  const key = (process.env.STRIPE_SECRET_KEY || '').trim();
  if (!key || key.startsWith('CHANGE_ME')) return null;
  try {
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
    });
    const json = (await res.json().catch(() => null)) as Record<string, any> | null;
    if (!res.ok || !json) return null;
    const status = String(json.status || '').toLowerCase();
    const checkoutUrl = String(json.url || '').trim();
    const sid = String(json.id || id).trim();
    if (!checkoutUrl || !sid) return null;
    if (status && status !== 'open') return null;
    return { checkoutUrl, sessionId: sid };
  } catch {
    return null;
  }
}

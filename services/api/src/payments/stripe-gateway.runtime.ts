import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  STRIPE_GATEWAY_SETTING_KEY,
  STRIPE_WEBHOOK_SECRET_ENV,
} from './stripe-gateway.constants';

export type StripeGatewayRuntimeConfig = {
  enabled: boolean;
  webhook_endpoint_url: string;
  webhook_signing_secret: string;
  enabled_events: string[];
};

function normalizeWebhookSecret(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\r\n/g, '')
    .replace(/\r/g, '');
}

function productionMode(): boolean {
  const env = (
    process.env.ENVIRONMENT ||
    process.env.APP_ENV ||
    process.env.NODE_ENV ||
    ''
  )
    .trim()
    .toLowerCase();
  return env === 'production' || env === 'prod' || env === 'live';
}

function storeWebhookSecretAllowed(): boolean {
  const allow = (process.env.STRIPE_WEBHOOK_ALLOW_STORE_SECRET || 'true').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(allow);
}

export async function loadStripeGatewayConfig(
  prisma: PrismaService,
): Promise<StripeGatewayRuntimeConfig> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: STRIPE_GATEWAY_SETTING_KEY },
  });
  const raw =
    row && typeof row.value === 'object' && row.value !== null && !Array.isArray(row.value)
      ? (row.value as Record<string, unknown>)
      : {};
  return {
    enabled: Boolean(raw.enabled),
    webhook_endpoint_url: String(raw.webhook_endpoint_url || ''),
    webhook_signing_secret: String(raw.webhook_signing_secret || ''),
    enabled_events: Array.isArray(raw.enabled_events)
      ? raw.enabled_events.map((e) => String(e)).filter(Boolean)
      : [],
  };
}

/** Env first (incl. STRIPE_WEBHOOK_SECRETS), then optional store fallback. */
export function resolveStripeWebhookSecrets(storeSecret = ''): string[] {
  const secrets: string[] = [];
  const multi = (process.env.STRIPE_WEBHOOK_SECRETS || '').trim();
  if (multi) {
    for (const item of multi.split(',')) {
      const text = normalizeWebhookSecret(item);
      if (text && !secrets.includes(text)) secrets.push(text);
    }
  }
  const envSecret = normalizeWebhookSecret(process.env[STRIPE_WEBHOOK_SECRET_ENV] || '');
  if (envSecret && !secrets.includes(envSecret)) secrets.push(envSecret);
  if (secrets.length) return secrets;

  if (productionMode() && !storeWebhookSecretAllowed()) return [];
  const fromStore = normalizeWebhookSecret(storeSecret);
  if (fromStore) secrets.push(fromStore);
  return secrets;
}

export function webhookToleranceSec(): number {
  const raw = (process.env.STRIPE_WEBHOOK_TOLERANCE_SEC || '300').trim();
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 300;
}

/**
 * Verify Stripe-Signature against one or more webhook secrets (HMAC-SHA256).
 * Requires the exact raw request body bytes.
 */
export function verifyStripeSignature(
  payload: Buffer,
  sigHeader: string,
  secrets: string[],
  toleranceSec = webhookToleranceSec(),
): boolean {
  const header = String(sigHeader || '').trim();
  if (!header || !payload?.length || !secrets.length) return false;
  if (secrets.some((s) => s.startsWith('CHANGE_ME'))) return false;

  let timestamp = '';
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.split('=').map((s) => s.trim());
    if (k === 't') timestamp = v || '';
    if (k === 'v1' && v) signatures.push(v);
  }
  if (!timestamp || !signatures.length) return false;

  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (toleranceSec > 0 && Math.abs(now - ts) > toleranceSec) return false;

  const signedPayload = Buffer.from(`${timestamp}.${payload.toString('utf8')}`, 'utf8');

  for (const secret of secrets) {
    const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
    for (const sig of signatures) {
      try {
        const a = Buffer.from(expected, 'utf8');
        const b = Buffer.from(sig, 'utf8');
        if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
      } catch {
        /* continue */
      }
    }
  }
  return false;
}

export function parseStripeWebhookPayload(payload: any): {
  eventId: string | null;
  eventType: string | null;
  orderNo: string | null;
  externalRef?: string;
  /** Major currency units (e.g. USD dollars). Only set for flat/dev payloads. */
  payAmountMajor?: string;
  fromFlatPayload?: boolean;
  currency?: string;
} {
  if (!payload || typeof payload !== 'object') {
    return { eventId: null, eventType: null, orderNo: null };
  }

  const eventId = payload.id ? String(payload.id) : null;
  const eventType = payload.type ? String(payload.type) : null;

  // Dev / shared-secret style: flat body with orderNo (amounts already major units).
  if (payload.orderNo) {
    return {
      eventId,
      eventType,
      orderNo: String(payload.orderNo),
      externalRef: payload.externalRef ? String(payload.externalRef) : undefined,
      payAmountMajor: payload.payAmount != null ? String(payload.payAmount) : undefined,
      fromFlatPayload: true,
      currency: payload.currency ? String(payload.currency) : undefined,
    };
  }

  const obj = payload?.data?.object;
  if (!obj || typeof obj !== 'object') {
    return { eventId, eventType, orderNo: null };
  }

  const meta = obj.metadata && typeof obj.metadata === 'object' ? obj.metadata : {};
  const orderNo =
    meta.orderNo ||
    meta.order_no ||
    obj.client_reference_id ||
    meta.orderId ||
    null;

  return {
    eventId,
    eventType,
    orderNo: orderNo ? String(orderNo) : null,
    externalRef: obj.payment_intent
      ? String(obj.payment_intent)
      : obj.id
        ? String(obj.id)
        : undefined,
    fromFlatPayload: false,
    currency: obj.currency ? String(obj.currency).toUpperCase() : undefined,
  };
}

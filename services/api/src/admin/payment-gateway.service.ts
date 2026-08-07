import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { BizException, BizCode } from '../common/biz.exception';
import { writeEnvValues } from './env-file.util';
import {
  STRIPE_GATEWAY_SETTING_KEY,
  STRIPE_SECRET_KEY_ENV,
  STRIPE_WEBHOOK_SECRET_ENV,
  WEBHOOK_RECEIVER_PATH,
} from '../payments/stripe-gateway.constants';

export {
  STRIPE_GATEWAY_SETTING_KEY,
  STRIPE_SECRET_KEY_ENV,
  STRIPE_WEBHOOK_SECRET_ENV,
  WEBHOOK_RECEIVER_PATH,
} from '../payments/stripe-gateway.constants';

export type StripeGatewayStored = {
  provider: 'stripe';
  enabled: boolean;
  webhook_endpoint_url: string;
  webhook_signing_secret: string;
  enabled_events: string[];
  created_at: string;
  updated_at: string;
};

export type StripeGatewayPublic = StripeGatewayStored & {
  secret_key_env: string;
  webhook_secret_env: string;
  secret_key_masked: string;
  has_webhook_signing_secret: boolean;
  has_secret_key: boolean;
  has_env_webhook_secret: boolean;
  webhook_secret_source: 'env' | 'store' | 'none';
  webhook_receiver_path: string;
  webhook_receiver_url: string;
  backend_public_url: string | null;
  checkout_enabled: boolean;
  frontend_public_url: string;
  subscription_success_url: string;
  subscription_cancel_url: string;
  recommended_events: string[];
  signature_header: string;
  docs: {
    webhooks: string;
    signatures: string;
    checkout: string;
    dashboard_developers: string;
    dashboard_webhooks: string;
  };
};

export type StripeGatewayUpdateInput = {
  enabled?: boolean;
  secret_key?: string;
  webhook_signing_secret?: string;
  enabled_events?: string[];
};

export function defaultStripeEvents(): string[] {
  return [
    'checkout.session.completed',
    'checkout.session.expired',
    'invoice.payment_succeeded',
    'invoice_payment.paid',
    'invoice.payment_failed',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'charge.refunded',
    'refund.updated',
  ];
}

function defaultStripeSettings(now = new Date()): StripeGatewayStored {
  const ts = now.toISOString();
  return {
    provider: 'stripe',
    enabled: false,
    webhook_endpoint_url: '',
    webhook_signing_secret: '',
    enabled_events: defaultStripeEvents(),
    created_at: ts,
    updated_at: ts,
  };
}

function maskSecret(value: unknown): string {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 10) return '*'.repeat(text.length);
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function preserveSecret(raw: string, current: string, masked = ''): string {
  const text = (raw || '').trim();
  if (!text || [...text].every((c) => c === '*') || text.includes('...')) {
    return current;
  }
  if (masked && text === masked) return current;
  return text;
}

function publicBaseUrl(): string {
  return (
    process.env.STRIPE_WEBHOOK_PUBLIC_URL ||
    process.env.BACKEND_PUBLIC_URL ||
    process.env.PUBLIC_BASE_URL ||
    ''
  )
    .trim()
    .replace(/\/+$/, '');
}

function webhookReceiverUrl(): string {
  const base = publicBaseUrl();
  return base ? `${base}${WEBHOOK_RECEIVER_PATH}` : '';
}

function checkoutReturnUrls() {
  const frontendBase = (process.env.WEB_BASE_URL || process.env.FRONTEND_PUBLIC_URL || 'http://localhost:3000')
    .trim()
    .replace(/\/+$/, '');
  let success = (process.env.SUBSCRIPTION_SUCCESS_URL || process.env.VIP_SUCCESS_URL || '').trim();
  let cancel = (process.env.SUBSCRIPTION_CANCEL_URL || process.env.VIP_CANCEL_URL || '').trim();
  if (!success) success = `${frontendBase}/wallet/result?status=success`;
  if (!cancel) cancel = `${frontendBase}/wallet/result?status=cancel`;
  return { success_url: success, cancel_url: cancel, frontend_public_url: frontendBase };
}

function isStripeSecretConfigured(): boolean {
  const key = (process.env.STRIPE_SECRET_KEY || '').trim();
  if (!key) return false;
  if (key.startsWith('CHANGE_ME')) return false;
  return true;
}

@Injectable()
export class PaymentGatewayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async loadStored(): Promise<StripeGatewayStored> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: STRIPE_GATEWAY_SETTING_KEY },
    });
    if (!row || typeof row.value !== 'object' || row.value === null || Array.isArray(row.value)) {
      return defaultStripeSettings();
    }
    const raw = row.value as Record<string, unknown>;
    const base = defaultStripeSettings();
    return {
      provider: 'stripe',
      enabled: Boolean(raw.enabled),
      webhook_endpoint_url: String(raw.webhook_endpoint_url || ''),
      webhook_signing_secret: String(raw.webhook_signing_secret || ''),
      enabled_events: Array.isArray(raw.enabled_events)
        ? raw.enabled_events.map((e) => String(e)).filter(Boolean)
        : base.enabled_events,
      created_at: String(raw.created_at || base.created_at),
      updated_at: String(raw.updated_at || row.updatedAt?.toISOString() || base.updated_at),
    };
  }

  private toPublic(settings: StripeGatewayStored): StripeGatewayPublic {
    const envWebhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
    const storeWebhookSecret = String(settings.webhook_signing_secret || '').trim();
    let webhookSecretSource: 'env' | 'store' | 'none' = 'none';
    let hasWebhookSigningSecret = false;
    if (envWebhookSecret) {
      webhookSecretSource = 'env';
      hasWebhookSigningSecret = true;
    } else if (storeWebhookSecret) {
      webhookSecretSource = 'store';
      hasWebhookSigningSecret = true;
    }

    const envSecretKey = (process.env.STRIPE_SECRET_KEY || '').trim();
    const receiverUrl = webhookReceiverUrl();
    const hasSecretKey = isStripeSecretConfigured();
    const returnUrls = checkoutReturnUrls();

    return {
      ...settings,
      webhook_signing_secret: maskSecret(envWebhookSecret || settings.webhook_signing_secret),
      has_webhook_signing_secret: hasWebhookSigningSecret,
      secret_key_env: STRIPE_SECRET_KEY_ENV,
      webhook_secret_env: STRIPE_WEBHOOK_SECRET_ENV,
      secret_key_masked: maskSecret(envSecretKey),
      has_secret_key: hasSecretKey,
      has_env_webhook_secret: Boolean(envWebhookSecret),
      webhook_secret_source: webhookSecretSource,
      webhook_receiver_path: WEBHOOK_RECEIVER_PATH,
      webhook_receiver_url: receiverUrl,
      webhook_endpoint_url: receiverUrl,
      backend_public_url: publicBaseUrl() || null,
      checkout_enabled: Boolean(
        settings.enabled && hasSecretKey && hasWebhookSigningSecret && receiverUrl,
      ),
      frontend_public_url: returnUrls.frontend_public_url,
      subscription_success_url: returnUrls.success_url,
      subscription_cancel_url: returnUrls.cancel_url,
      recommended_events: defaultStripeEvents(),
      signature_header: 'Stripe-Signature',
      docs: {
        webhooks: 'https://docs.stripe.com/webhooks',
        signatures: 'https://docs.stripe.com/webhooks/signatures',
        checkout: 'https://docs.stripe.com/checkout/quickstart',
        dashboard_developers: 'https://dashboard.stripe.com/developers',
        dashboard_webhooks: 'https://dashboard.stripe.com/webhooks',
      },
    };
  }

  async getStripeSettings(): Promise<StripeGatewayPublic> {
    return this.toPublic(await this.loadStored());
  }

  async updateStripeSettings(
    body: StripeGatewayUpdateInput,
    actorId?: bigint,
  ): Promise<StripeGatewayPublic> {
    const current = await this.loadStored();
    const enabled = Boolean(body.enabled);

    const envSecretKey = (process.env.STRIPE_SECRET_KEY || '').trim();
    const secretKey = preserveSecret(
      String(body.secret_key || ''),
      envSecretKey,
      maskSecret(envSecretKey),
    );

    const envUpdates: Record<string, string> = {};
    if (secretKey !== envSecretKey) {
      envUpdates[STRIPE_SECRET_KEY_ENV] = secretKey;
    }

    const secret = String(body.webhook_signing_secret || '').trim();
    const envWebhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
    const storeWebhookSecret = String(current.webhook_signing_secret || '');
    const currentWebhookSecret = envWebhookSecret || storeWebhookSecret;
    const webhookSecret = preserveSecret(secret, currentWebhookSecret, maskSecret(currentWebhookSecret));

    const receiverUrl = webhookReceiverUrl();
    if (enabled && !receiverUrl.trim()) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        'Stripe webhook URL is not available; configure PUBLIC_BASE_URL, BACKEND_PUBLIC_URL or STRIPE_WEBHOOK_PUBLIC_URL',
      );
    }
    if (enabled && !webhookSecret) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        'Stripe webhook signing secret is required when enabled',
      );
    }
    if (webhookSecret !== envWebhookSecret) {
      envUpdates[STRIPE_WEBHOOK_SECRET_ENV] = webhookSecret;
    }

    let webhookSecretForStore = '';
    if (!envWebhookSecret && !(STRIPE_WEBHOOK_SECRET_ENV in envUpdates)) {
      webhookSecretForStore = webhookSecret;
    }

    const events = (body.enabled_events || [])
      .map((e) => String(e || '').trim())
      .filter(Boolean)
      .slice(0, 50);
    if (enabled && !events.length) {
      throw new BizException(BizCode.BAD_REQUEST, 'At least one Stripe event is required when enabled');
    }

    const now = new Date().toISOString();
    const updated: StripeGatewayStored = {
      provider: 'stripe',
      enabled,
      webhook_endpoint_url: receiverUrl.trim(),
      webhook_signing_secret: webhookSecretForStore,
      enabled_events: events.length ? events : defaultStripeEvents(),
      created_at: current.created_at || now,
      updated_at: now,
    };

    try {
      // Write secrets first so we never persist enabled=true without durable secrets.
      if (Object.keys(envUpdates).length) {
        writeEnvValues(envUpdates);
      }
      await this.prisma.systemSetting.upsert({
        where: { key: STRIPE_GATEWAY_SETTING_KEY },
        create: { key: STRIPE_GATEWAY_SETTING_KEY, value: updated as any },
        update: { value: updated as any },
      });
    } catch (err: any) {
      if (err?.code === 'EACCES' || err?.code === 'EPERM' || err?.code === 'EROFS') {
        throw new BizException(
          BizCode.BAD_REQUEST,
          'Unable to write payment gateway settings or .env (permission denied). Check services/api/.env write access, or set secrets manually and restart.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      if (err instanceof BizException) throw err;
      throw err;
    }

    await this.audit.write({
      actorId,
      action: 'paymentGateway.stripe.update',
      targetType: 'paymentGateway',
      targetId: 'stripe',
      payload: {
        enabled: updated.enabled,
        webhook_endpoint_url: updated.webhook_endpoint_url,
        events: updated.enabled_events,
        secret_key_updated: Boolean(envUpdates[STRIPE_SECRET_KEY_ENV]),
        webhook_secret_updated: Boolean(envUpdates[STRIPE_WEBHOOK_SECRET_ENV]),
      },
    });

    return this.toPublic(updated);
  }
}

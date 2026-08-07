/** Shared Stripe gateway setting key (admin store + webhook runtime). */
export const STRIPE_GATEWAY_SETTING_KEY = 'paymentGateways.stripe';
export const STRIPE_SECRET_KEY_ENV = 'STRIPE_SECRET_KEY';
export const STRIPE_WEBHOOK_SECRET_ENV = 'STRIPE_WEBHOOK_SECRET';
export const WEBHOOK_RECEIVER_PATH = '/api/v1/webhooks/stripe';

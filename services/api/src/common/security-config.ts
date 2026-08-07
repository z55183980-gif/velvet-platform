import { timingSafeEqual } from 'crypto';

const WEAK_SECRETS = new Set([
  '',
  'dev',
  'dev-secret',
  'dev-admin',
  'dev-webhook',
  'secret',
  'changeme',
]);

export function isProductionEnv(): boolean {
  return (process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

export function isWeakSecret(value: string | undefined | null): boolean {
  const v = String(value || '').trim();
  if (v.length < 16) return true;
  return WEAK_SECRETS.has(v.toLowerCase());
}

/** Resolve a secret; in production refuse weak/missing defaults. */
export function requireSecret(
  name: string,
  value: string | undefined | null,
  fallbackDev: string,
): string {
  const v = String(value || '').trim();
  if (v) {
    if (isProductionEnv() && isWeakSecret(v)) {
      throw new Error(`[security] ${name} is missing or too weak for production`);
    }
    return v;
  }
  if (isProductionEnv()) {
    throw new Error(`[security] ${name} is required in production`);
  }
  return fallbackDev;
}

export function assertProductionSecrets(): void {
  if (!isProductionEnv()) return;
  requireSecret('JWT_SECRET', process.env.JWT_SECRET, '');
  requireSecret('CDN_SIGN_KEY', process.env.CDN_SIGN_KEY, '');
  const bootstrapPw = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (bootstrapPw != null && String(bootstrapPw).trim() !== '') {
    if (String(bootstrapPw).length < 12 || isWeakSecret(bootstrapPw)) {
      throw new Error(
        '[security] ADMIN_BOOTSTRAP_PASSWORD must be strong (≥12 chars) in production',
      );
    }
  }
}

/** Constant-time string compare for webhook secrets. */
export function safeEqualString(a: string, b: string): boolean {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  try {
    return timingSafeEqual(aa, bb);
  } catch {
    return false;
  }
}

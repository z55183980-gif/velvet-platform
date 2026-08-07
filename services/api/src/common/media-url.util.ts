import { ConfigService } from '@nestjs/config';
import { signMediaPath } from './media-sign.util';
import { requireSecret } from './security-config';

/** Strip query and leading /api/v1/media/ so we can re-sign. */
export function normalizeMediaRelPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s; // external — leave as-is
  s = s.split('?')[0].replace(/^\/+/, '');
  if (s.startsWith('api/v1/media/')) s = s.slice('api/v1/media/'.length);
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep */
  }
  return s.replace(/\\/g, '/') || null;
}

/** Fresh signed /api/v1/media/... URL for private docs (or any relative media path). */
export function resignMediaUrl(
  raw: string | null | undefined,
  config: ConfigService,
  ttlSec = 3600,
): string | null {
  const rel = normalizeMediaRelPath(raw);
  if (!rel) return null;
  if (/^https?:\/\//i.test(rel)) return rel;
  const key = requireSecret(
    'CDN_SIGN_KEY',
    config.get<string>('CDN_SIGN_KEY'),
    'dev',
  );
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = signMediaPath(rel, exp, key);
  const encoded = rel.split('/').map(encodeURIComponent).join('/');
  return `/api/v1/media/${encoded}?sig=${sig}&exp=${exp}`;
}

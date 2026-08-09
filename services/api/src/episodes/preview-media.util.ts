import { createHmac, timingSafeEqual } from 'crypto';

/** Binding for preview gateway URLs (never bind full media path for unpaid users). */
export function previewSignPayload(episodeId: string | bigint, previewSeconds: number): string {
  return `ep-preview:${episodeId}:${Math.max(0, Math.floor(previewSeconds))}`;
}

export function signEpisodePreview(
  episodeId: string | bigint,
  previewSeconds: number,
  exp: number,
  key: string,
): string {
  return createHmac('sha256', key)
    .update(`${previewSignPayload(episodeId, previewSeconds)}:${exp}`)
    .digest('base64url');
}

export function verifyEpisodePreviewSig(
  episodeId: string | bigint,
  previewSeconds: number,
  exp: number | string | undefined,
  sig: string | undefined,
  key: string,
): boolean {
  if (!sig || exp == null || exp === '') return false;
  const expN = typeof exp === 'string' ? parseInt(exp, 10) : exp;
  if (!Number.isFinite(expN) || expN < Math.floor(Date.now() / 1000)) return false;
  const expected = signEpisodePreview(episodeId, previewSeconds, expN, key);
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** True when playlist is a master (multivariant) — EXTINF truncation does not apply. */
export function isMasterM3u8(body: string): boolean {
  return /^#EXT-X-STREAM-INF:/im.test(body);
}

/**
 * Pick a media-variant URI from a master playlist (lowest BANDWIDTH).
 * Ignores I-FRAME-STREAM-INF / EXT-X-MEDIA audio-only alts.
 */
export function pickMasterVariantUri(body: string): string | null {
  const lines = body.split(/\r?\n/);
  let bestUri: string | null = null;
  let bestBw = Number.POSITIVE_INFINITY;
  let pendingBw: number | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^#EXT-X-I-FRAME-STREAM-INF:/i.test(trimmed)) {
      pendingBw = null;
      continue;
    }
    if (/^#EXT-X-STREAM-INF:/i.test(trimmed)) {
      const m = /BANDWIDTH=(\d+)/i.exec(trimmed);
      pendingBw = m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
      continue;
    }
    if (pendingBw != null && !trimmed.startsWith('#')) {
      if (Number.isFinite(pendingBw) && pendingBw < bestBw) {
        bestBw = pendingBw;
        bestUri = trimmed;
      }
      pendingBw = null;
    }
  }
  return bestUri;
}

/**
 * Resolve a playlist-relative URI to a posix path (no leading slash).
 * Absolute http(s) children are returned only as absoluteUrl — callers must
 * SSRF-validate / allowlist before fetching (prefer relative under same origin).
 */
export function resolvePlaylistChildUri(
  playlistRelPath: string,
  uri: string,
): { absoluteUrl: string } | { relativePath: string } | null {
  const raw = String(uri || '').trim();
  if (!raw || /^data:/i.test(raw)) return null;
  if (/^https?:\/\//i.test(raw)) return { absoluteUrl: raw };

  const pathOnly = raw.split(/[?#]/)[0];
  if (!pathOnly) return null;
  if (pathOnly.startsWith('/')) {
    return { relativePath: pathOnly.replace(/^\/+/, '') };
  }
  const playlistPosix = playlistRelPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const dir = playlistPosix.includes('/')
    ? playlistPosix.slice(0, playlistPosix.lastIndexOf('/'))
    : '';
  const joined = dir ? `${dir}/${pathOnly}` : pathOnly;
  const normalized = joined
    .split('/')
    .reduce<string[]>((acc, part) => {
      if (!part || part === '.') return acc;
      if (part === '..') {
        acc.pop();
        return acc;
      }
      acc.push(part);
      return acc;
    }, [])
    .join('/');
  return { relativePath: normalized };
}

/** Keep only media segments until cumulative EXTINF >= previewSeconds. */
export function truncateM3u8ByDuration(body: string, previewSeconds: number): string {
  const limit = Math.max(1, previewSeconds);
  const endsWithNl = /\r?\n$/.test(body);
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  let elapsed = 0;
  let pendingInf: string | null = null;
  let sawEndList = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push(line);
      continue;
    }
    if (trimmed.startsWith('#EXTINF:')) {
      if (elapsed >= limit) break;
      pendingInf = line;
      const m = /^#EXTINF:([0-9.]+)/i.exec(trimmed);
      const dur = m ? Number(m[1]) : 0;
      if (Number.isFinite(dur) && dur > 0) elapsed += dur;
      continue;
    }
    if (trimmed.startsWith('#')) {
      if (/^#EXT-X-ENDLIST/i.test(trimmed)) {
        sawEndList = true;
        continue;
      }
      out.push(line);
      continue;
    }
    // URI line for previous EXTINF
    if (pendingInf != null) {
      if (elapsed > limit && out.length > 0) {
        // last EXTINF pushed us over: still include this first overflowing segment
      }
      out.push(pendingInf);
      out.push(line);
      pendingInf = null;
      if (elapsed >= limit) break;
      continue;
    }
    out.push(line);
  }

  if (!sawEndList && !out.some((l) => /^#EXT-X-ENDLIST/i.test(l.trim()))) {
    out.push('#EXT-X-ENDLIST');
  }
  const joined = out.join('\n');
  return endsWithNl ? `${joined}\n` : joined;
}

/** Estimate byte cap for progressive media (~2.5 Mbps default). */
export function estimatePreviewMaxBytes(
  previewSeconds: number,
  durationSec?: number | null,
  fileSize?: number | null,
): number {
  const sec = Math.max(1, Math.floor(previewSeconds));
  if (fileSize && fileSize > 0 && durationSec && durationSec > 0) {
    return Math.max(64 * 1024, Math.ceil((fileSize * sec) / durationSec));
  }
  const bytesPerSec = Math.ceil((2.5 * 1000 * 1000) / 8);
  return Math.max(64 * 1024, bytesPerSec * sec);
}

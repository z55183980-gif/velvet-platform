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

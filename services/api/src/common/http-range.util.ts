export type ByteRangeResult =
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'range'; start: number; end: number };

/** Parse one RFC 7233 byte range. Multiple ranges are intentionally unsupported. */
export function parseSingleByteRange(
  header: string | undefined,
  size: number,
): ByteRangeResult {
  if (!header) return { kind: 'none' };
  if (!Number.isSafeInteger(size) || size <= 0) return { kind: 'invalid' };

  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match) return { kind: 'invalid' };

  const startRaw = match[1];
  const endRaw = match[2];
  if (!startRaw && !endRaw) return { kind: 'invalid' };

  if (!startRaw) {
    const suffixLength = Number.parseInt(endRaw, 10);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { kind: 'invalid' };
    return {
      kind: 'range',
      start: Math.max(0, size - suffixLength),
      end: size - 1,
    };
  }

  const start = Number.parseInt(startRaw, 10);
  if (!Number.isSafeInteger(start) || start < 0 || start >= size) return { kind: 'invalid' };
  if (!endRaw) return { kind: 'range', start, end: size - 1 };

  const requestedEnd = Number.parseInt(endRaw, 10);
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return { kind: 'invalid' };
  return { kind: 'range', start, end: Math.min(requestedEnd, size - 1) };
}

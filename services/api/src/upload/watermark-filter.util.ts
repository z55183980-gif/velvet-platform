const REELSHORT_HOST = 'reelshort.com';

export type NormalizedWatermarkBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ReelShortWatermarkPlacement = {
  /** Complete legacy mark, including the ReelShort wordmark. */
  fullMark: NormalizedWatermarkBox;
  /** Square ReelShort icon; the replacement mark is aligned to this box. */
  icon: NormalizedWatermarkBox;
  confidence: number;
  source: 'vision' | 'fallback';
};

export type ReelShortWatermarkLayout = {
  topLeft?: ReelShortWatermarkPlacement | null;
  bottomRight?: ReelShortWatermarkPlacement | null;
};

export type ReelShortVisionDetection = {
  found?: unknown;
  confidence?: unknown;
  fullMark?: Partial<Record<keyof NormalizedWatermarkBox, unknown>>;
  icon?: Partial<Record<keyof NormalizedWatermarkBox, unknown>>;
};

/** Approved fallback for a 1080x1920 ReelShort source, expressed as ratios. */
export const DEFAULT_REELSHORT_WATERMARK_PLACEMENT: ReelShortWatermarkPlacement = {
  fullMark: {
    x: 96 / 1080,
    y: 136 / 1920,
    width: 120 / 1080,
    height: 120 / 1920,
  },
  icon: {
    x: 100 / 1080,
    y: 140 / 1920,
    width: 115 / 1080,
    height: 115 / 1920,
  },
  confidence: 0,
  source: 'fallback',
};

/** Only trust the canonical ReelShort host (or one of its real subdomains). */
export function isReelShortSource(
  sourceProvider?: string | null,
  sourcePageUrl?: string | null,
) {
  if (String(sourceProvider || '').toLowerCase().includes('reelshort')) return true;
  try {
    const hostname = new URL(String(sourcePageUrl || '')).hostname.toLowerCase();
    return hostname === REELSHORT_HOST || hostname.endsWith(`.${REELSHORT_HOST}`);
  } catch {
    return false;
  }
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readBox(
  raw: ReelShortVisionDetection['fullMark'],
): NormalizedWatermarkBox | null {
  const x = finiteNumber(raw?.x);
  const y = finiteNumber(raw?.y);
  const width = finiteNumber(raw?.width);
  const height = finiteNumber(raw?.height);
  if (x == null || y == null || width == null || height == null) return null;
  if (
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0 ||
    x + width > 1.001 ||
    y + height > 1.001
  ) {
    return null;
  }
  return { x, y, width, height };
}

function boxContainsWithTolerance(
  outer: NormalizedWatermarkBox,
  inner: NormalizedWatermarkBox,
  tolerance: number,
) {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

/**
 * Validate a vision result and translate crop-relative coordinates back to the
 * full video frame. The crop is always anchored at the top-left.
 */
export function normalizeReelShortVisionDetection(
  raw: ReelShortVisionDetection,
  opts: {
    cropWidthRatio: number;
    cropHeightRatio: number;
    cropXRatio?: number;
    cropYRatio?: number;
    expectedCorner?: 'top-left' | 'bottom-right';
    minimumConfidence?: number;
  },
): ReelShortWatermarkPlacement | null {
  if (raw?.found !== true) return null;
  const confidence = finiteNumber(raw.confidence);
  const minimumConfidence = Math.max(
    0,
    Math.min(1, opts.minimumConfidence ?? 0.72),
  );
  if (confidence == null || confidence < minimumConfidence || confidence > 1) {
    return null;
  }

  const cropWidthRatio = finiteNumber(opts.cropWidthRatio);
  const cropHeightRatio = finiteNumber(opts.cropHeightRatio);
  const cropXRatio = finiteNumber(opts.cropXRatio ?? 0);
  const cropYRatio = finiteNumber(opts.cropYRatio ?? 0);
  if (
    cropWidthRatio == null ||
    cropHeightRatio == null ||
    cropXRatio == null ||
    cropYRatio == null ||
    cropWidthRatio <= 0 ||
    cropHeightRatio <= 0 ||
    cropXRatio < 0 ||
    cropYRatio < 0 ||
    cropWidthRatio > 1 ||
    cropHeightRatio > 1 ||
    cropXRatio + cropWidthRatio > 1.001 ||
    cropYRatio + cropHeightRatio > 1.001
  ) {
    return null;
  }

  const cropFullMark = readBox(raw.fullMark);
  const cropIcon = readBox(raw.icon);
  if (!cropFullMark || !cropIcon) return null;
  if (!boxContainsWithTolerance(cropFullMark, cropIcon, 0.04)) return null;

  const toFrame = (box: NormalizedWatermarkBox): NormalizedWatermarkBox => ({
    x: cropXRatio + box.x * cropWidthRatio,
    y: cropYRatio + box.y * cropHeightRatio,
    width: box.width * cropWidthRatio,
    height: box.height * cropHeightRatio,
  });
  const fullMark = toFrame(cropFullMark);
  const icon = toFrame(cropIcon);

  // Reject hallucinated large objects and boxes far from the expected corner.
  // Valid ranges are deliberately wider than current sources.
  const expectedCorner = opts.expectedCorner || 'top-left';
  const cornerPlausible =
    expectedCorner === 'bottom-right'
      ? fullMark.x + fullMark.width >= 0.72 &&
        fullMark.y + fullMark.height >= 0.72
      : fullMark.x <= 0.28 && fullMark.y <= 0.24;
  if (
    !cornerPlausible ||
    fullMark.width < 0.018 ||
    fullMark.width > 0.22 ||
    fullMark.height < 0.015 ||
    fullMark.height > 0.18 ||
    icon.width < 0.015 ||
    icon.width > 0.18 ||
    icon.height < 0.012 ||
    icon.height > 0.16
  ) {
    return null;
  }

  return {
    fullMark,
    icon,
    confidence,
    source: 'vision',
  };
}

function even(value: number, minimum = 2) {
  const rounded = Math.round(value / 2) * 2;
  return Math.max(minimum, rounded);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function mirrorPlacement(
  placement: ReelShortWatermarkPlacement,
): ReelShortWatermarkPlacement {
  const mirrorBox = (box: NormalizedWatermarkBox): NormalizedWatermarkBox => ({
    x: 1 - box.x - box.width,
    y: 1 - box.y - box.height,
    width: box.width,
    height: box.height,
  });
  return {
    ...placement,
    fullMark: mirrorBox(placement.fullMark),
    icon: mirrorBox(placement.icon),
  };
}

function placementGeometry(
  placement: ReelShortWatermarkPlacement,
  frameWidth: number,
  frameHeight: number,
) {
  const padding = Math.max(4, Math.round(frameWidth * 0.006));
  const rawPatchX = Math.floor(placement.fullMark.x * frameWidth) - padding;
  const rawPatchY = Math.floor(placement.fullMark.y * frameHeight) - padding;
  const patchX = even(clamp(rawPatchX, 0, frameWidth - 4));
  const patchY = even(clamp(rawPatchY, 0, frameHeight - 4));
  const patchWidth = even(
    clamp(
      Math.ceil(placement.fullMark.width * frameWidth) + padding * 2,
      4,
      frameWidth - patchX,
    ),
    4,
  );
  const patchHeight = even(
    clamp(
      Math.ceil(placement.fullMark.height * frameHeight) + padding * 2,
      4,
      frameHeight - patchY,
    ),
    4,
  );
  const iconWidthPx = placement.icon.width * frameWidth;
  const iconHeightPx = placement.icon.height * frameHeight;
  const logoSize = even(Math.max(iconWidthPx, iconHeightPx), 4);
  const iconCenterX = (placement.icon.x + placement.icon.width / 2) * frameWidth;
  const iconCenterY = (placement.icon.y + placement.icon.height / 2) * frameHeight;
  const logoX = even(clamp(iconCenterX - logoSize / 2, 0, frameWidth - logoSize));
  const logoY = even(clamp(iconCenterY - logoSize / 2, 0, frameHeight - logoSize));
  return { patchX, patchY, patchWidth, patchHeight, logoX, logoY, logoSize };
}

/**
 * Blur the complete old mark and align the new square mark with the detected
 * icon. ReelShort alternates top-left / bottom-right every 30 seconds, so the
 * first-frame placement is mirrored for the second half of each minute.
 */
export function buildReelShortReplacementFilter(opts?: {
  frameWidth?: number;
  frameHeight?: number;
  layout?: ReelShortWatermarkLayout | null;
}) {
  const frameWidth = even(opts?.frameWidth || 1080);
  const frameHeight = even(opts?.frameHeight || 1920);
  const topLeftPlacement =
    opts?.layout?.topLeft || DEFAULT_REELSHORT_WATERMARK_PLACEMENT;
  const bottomRightPlacement =
    opts?.layout?.bottomRight || mirrorPlacement(DEFAULT_REELSHORT_WATERMARK_PLACEMENT);
  const topLeft = placementGeometry(topLeftPlacement, frameWidth, frameHeight);
  const bottomRight = placementGeometry(
    bottomRightPlacement,
    frameWidth,
    frameHeight,
  );
  const leftActive = 'lt(mod(t,60),30)';
  const rightActive = 'gte(mod(t,60),30)';

  return [
    '[0:v]split=3[base][tl_src][br_src]',
    '[1:v]format=rgba,colorchannelmixer=aa=0.80,split=2[wm_src1][wm_src2]',
    `[wm_src1]scale=${topLeft.logoSize}:${topLeft.logoSize}:flags=lanczos[wm1]`,
    `[wm_src2]scale=${bottomRight.logoSize}:${bottomRight.logoSize}:flags=lanczos[wm2]`,
    `[tl_src]crop=w=${topLeft.patchWidth}:h=${topLeft.patchHeight}:x=${topLeft.patchX}:y=${topLeft.patchY},boxblur=12:2[tl_patch]`,
    `[br_src]crop=w=${bottomRight.patchWidth}:h=${bottomRight.patchHeight}:x=${bottomRight.patchX}:y=${bottomRight.patchY},boxblur=12:2[br_patch]`,
    `[base][tl_patch]overlay=x=${topLeft.patchX}:y=${topLeft.patchY}:enable='${leftActive}'[blur1]`,
    `[blur1][br_patch]overlay=x=${bottomRight.patchX}:y=${bottomRight.patchY}:enable='${rightActive}'[clean]`,
    `[clean][wm1]overlay=x=${topLeft.logoX}:y=${topLeft.logoY}:enable='${leftActive}'[wmleft]`,
    `[wmleft][wm2]overlay=x=${bottomRight.logoX}:y=${bottomRight.logoY}:enable='${rightActive}'[vout]`,
  ].join(';');
}

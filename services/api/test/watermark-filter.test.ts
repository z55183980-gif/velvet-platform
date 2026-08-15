import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_REELSHORT_WATERMARK_PLACEMENT,
  buildReelShortReplacementFilter,
  isReelShortSource,
  normalizeReelShortVisionDetection,
} from '../src/upload/watermark-filter.util';

test('ReelShort source detection accepts only the real host or provider', () => {
  assert.equal(isReelShortSource('reelshort', null), true);
  assert.equal(isReelShortSource('ytdlp', 'https://www.reelshort.com/episodes/1'), true);
  assert.equal(isReelShortSource(null, 'https://cdn.reelshort.com/video'), true);
  assert.equal(isReelShortSource(null, 'https://reelshort.com.evil.example/video'), false);
  assert.equal(isReelShortSource(null, 'not a url'), false);
});

test('replacement filter scales approved fallback geometry to the video frame', () => {
  const filter = buildReelShortReplacementFilter({
    frameWidth: 1080,
    frameHeight: 1920,
    layout: { topLeft: DEFAULT_REELSHORT_WATERMARK_PLACEMENT },
  });
  assert.match(filter, /scale=116:116:flags=lanczos/);
  assert.match(filter, /colorchannelmixer=aa=0\.80/);
  assert.match(filter, /boxblur=12:2/);
  assert.match(filter, /lt\(mod\(t,60\),30\)/);
  assert.match(filter, /gte\(mod\(t,60\),30\)/);
  assert.match(filter, /\[vout\]$/);
});

test('vision boxes are translated from the enlarged corner crop to the full frame', () => {
  const placement = normalizeReelShortVisionDetection(
    {
      found: true,
      confidence: 0.94,
      fullMark: { x: 0.12, y: 0.16, width: 0.26, height: 0.34 },
      icon: { x: 0.14, y: 0.17, width: 0.2, height: 0.22 },
    },
    { cropWidthRatio: 0.36, cropHeightRatio: 0.36 },
  );

  assert.ok(placement);
  assert.equal(placement.source, 'vision');
  assert.equal(placement.confidence, 0.94);
  assert.ok(Math.abs(placement.fullMark.x - 0.0432) < 1e-8);
  assert.ok(Math.abs(placement.icon.width - 0.072) < 1e-8);
  const filter = buildReelShortReplacementFilter({
    frameWidth: 1080,
    frameHeight: 1920,
    layout: { topLeft: placement },
  });
  assert.match(filter, /scale=152:152:flags=lanczos/);
});

test('bottom-right detection is independently positioned instead of mirrored', () => {
  const bottomRight = normalizeReelShortVisionDetection(
    {
      found: true,
      confidence: 0.96,
      fullMark: { x: 0.42, y: 0.38, width: 0.32, height: 0.3 },
      icon: { x: 0.46, y: 0.42, width: 0.22, height: 0.13 },
    },
    {
      cropWidthRatio: 0.36,
      cropHeightRatio: 0.36,
      cropXRatio: 0.64,
      cropYRatio: 0.64,
      expectedCorner: 'bottom-right',
    },
  );
  assert.ok(bottomRight);
  assert.ok(bottomRight.fullMark.x > 0.75);
  assert.ok(bottomRight.fullMark.y > 0.75);

  const fallbackOnly = buildReelShortReplacementFilter({
    frameWidth: 1080,
    frameHeight: 1920,
  });
  const detected = buildReelShortReplacementFilter({
    frameWidth: 1080,
    frameHeight: 1920,
    layout: { bottomRight },
  });
  assert.notEqual(detected, fallbackOnly);
  assert.match(detected, /\[br_src\]crop=w=138:h=220:x=848:y=1486/);
});

test('vision result fails closed on low confidence or implausible geometry', () => {
  const base = {
    found: true,
    confidence: 0.5,
    fullMark: { x: 0.12, y: 0.16, width: 0.26, height: 0.34 },
    icon: { x: 0.14, y: 0.17, width: 0.2, height: 0.22 },
  };
  assert.equal(
    normalizeReelShortVisionDetection(base, {
      cropWidthRatio: 0.36,
      cropHeightRatio: 0.36,
    }),
    null,
  );
  assert.equal(
    normalizeReelShortVisionDetection(
      {
        ...base,
        confidence: 0.95,
        icon: { x: 0.8, y: 0.8, width: 0.1, height: 0.1 },
      },
      { cropWidthRatio: 0.36, cropHeightRatio: 0.36 },
    ),
    null,
  );
});

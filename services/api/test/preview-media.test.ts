import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isMasterM3u8,
  pickMasterVariantUri,
  resolvePlaylistChildUri,
  truncateM3u8ByDuration,
} from '../src/episodes/preview-media.util';

const MASTER = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
low/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
high/index.m3u8
`;

const MEDIA = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXTINF:4.0,
seg0.ts
#EXTINF:4.0,
seg1.ts
#EXTINF:4.0,
seg2.ts
#EXTINF:4.0,
seg3.ts
#EXT-X-ENDLIST
`;

test('isMasterM3u8 detects multivariant playlists', () => {
  assert.equal(isMasterM3u8(MASTER), true);
  assert.equal(isMasterM3u8(MEDIA), false);
});

test('pickMasterVariantUri prefers lowest BANDWIDTH', () => {
  assert.equal(pickMasterVariantUri(MASTER), 'low/index.m3u8');
});

test('truncateM3u8ByDuration does not remove master variant URIs (unsafe alone)', () => {
  // Documents the bypass: truncation is a no-op on masters — callers must resolve first.
  const out = truncateM3u8ByDuration(MASTER, 8);
  assert.equal(isMasterM3u8(out), true);
  assert.match(out, /high\/index\.m3u8/);
});

test('truncateM3u8ByDuration keeps only preview window on media playlists', () => {
  const out = truncateM3u8ByDuration(MEDIA, 8);
  assert.equal(isMasterM3u8(out), false);
  assert.match(out, /seg0\.ts/);
  assert.match(out, /seg1\.ts/);
  assert.doesNotMatch(out, /seg3\.ts/);
  assert.match(out, /#EXT-X-ENDLIST/);
});

test('resolvePlaylistChildUri resolves relative and absolute children', () => {
  assert.deepEqual(resolvePlaylistChildUri('v/1/index.m3u8', 'low/index.m3u8'), {
    relativePath: 'v/1/low/index.m3u8',
  });
  assert.deepEqual(resolvePlaylistChildUri('v/1/index.m3u8', '/hls/ep/media.m3u8'), {
    relativePath: 'hls/ep/media.m3u8',
  });
  assert.deepEqual(
    resolvePlaylistChildUri('v/1/index.m3u8', 'https://cdn.example/v/1/low/index.m3u8'),
    { absoluteUrl: 'https://cdn.example/v/1/low/index.m3u8' },
  );
});

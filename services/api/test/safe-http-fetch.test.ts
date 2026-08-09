import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hostAllowedForMediaFetch,
  isPrivateOrReservedIp,
  mediaFetchAllowHosts,
  safeFetchText,
} from '../src/common/safe-http-fetch';
import { BizException } from '../src/common/biz.exception';

test('isPrivateOrReservedIp blocks RFC1918, loopback, link-local metadata', () => {
  assert.equal(isPrivateOrReservedIp('127.0.0.1'), true);
  assert.equal(isPrivateOrReservedIp('10.0.0.1'), true);
  assert.equal(isPrivateOrReservedIp('192.168.1.1'), true);
  assert.equal(isPrivateOrReservedIp('172.16.0.1'), true);
  assert.equal(isPrivateOrReservedIp('169.254.169.254'), true);
  assert.equal(isPrivateOrReservedIp('8.8.8.8'), false);
  assert.equal(isPrivateOrReservedIp('::1'), true);
});

test('hostAllowedForMediaFetch requires allowlist', () => {
  assert.equal(hostAllowedForMediaFetch('evil.example', []), false);
  assert.equal(hostAllowedForMediaFetch('cdn.velvetmovie.space', ['cdn.velvetmovie.space']), true);
  assert.equal(hostAllowedForMediaFetch('localhost', ['cdn.velvetmovie.space']), false);
  assert.equal(
    hostAllowedForMediaFetch('media.cdn.velvetmovie.space', ['cdn.velvetmovie.space']),
    true,
  );
});

test('mediaFetchAllowHosts always includes production CDN host', () => {
  const hosts = mediaFetchAllowHosts('https://cdn.velvetmovie.space/media/');
  assert.ok(hosts.includes('cdn.velvetmovie.space'));
});

test('safeFetchText refuses private IP hosts even if allowlisted by name trick', async () => {
  await assert.rejects(
    () =>
      safeFetchText('http://127.0.0.1/playlist.m3u8', {
        allowHosts: ['127.0.0.1'],
        fetchImpl: (async () => {
          throw new Error('should not fetch');
        }) as typeof fetch,
      }),
    (e: any) => e instanceof BizException && e.message === 'fetch.privateIpDenied',
  );
});

test('safeFetchText refuses non-allowlisted external hosts', async () => {
  await assert.rejects(
    () =>
      safeFetchText('https://evil.example/x.m3u8', {
        allowHosts: ['cdn.velvetmovie.space'],
        fetchImpl: (async () => {
          throw new Error('should not fetch');
        }) as typeof fetch,
      }),
    (e: any) => e instanceof BizException && e.message === 'fetch.hostDenied',
  );
});

test('safeFetchText accepts public allowlisted IP with m3u8 body', async () => {
  const fetchImpl = (async () =>
    ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/vnd.apple.mpegurl' },
      arrayBuffer: async () => Buffer.from('#EXTM3U\n#EXTINF:1,\nseg.ts\n'),
    }) as any) as typeof fetch;

  const text = await safeFetchText('https://8.8.8.8/playlist.m3u8', {
    allowHosts: ['8.8.8.8'],
    requireM3u8: true,
    fetchImpl,
  });
  assert.match(text, /#EXTM3U/);
});

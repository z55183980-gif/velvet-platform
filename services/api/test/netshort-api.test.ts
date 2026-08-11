import test from 'node:test';
import assert from 'node:assert/strict';
import {
  constants,
  createCipheriv,
  createDecipheriv,
  publicEncrypt,
} from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  createNetshortEncryptKeyHeader,
  encryptNetshortRequestBody,
  parseNetshortEpisodePage,
  resolveNetshortPlayUrl,
} from '../src/admin/netshort-api.util';
import {
  inferExternalUrlExpiry,
  isPlayableMediaUrl,
} from '../src/admin/online-drama.util';
import { YtdlpProvider } from '../src/admin/ytdlp.provider';

const REQUEST_KEY = Buffer.from(
  '5k3KYTOO9jnO0CeyGhdHc3pIjGnVgrMN',
  'utf8',
);

// Public half of module 88359's bundled response-decryption private key.
const RESPONSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAitE5daXe2400VPd21qB1
tYSwg49vvW4NTIGPI+Qu8V2sOmyX06F4Vmx9X1zW5xRVascmDRK3LjlMCWccg4HM
VFzOMlp0bHm9hhfexjonAENpHg81WJsJMuJa0kcL3F7rSUSz1AkUDX3OrqX5NhuU
yoevwnD+E1dXl0xe/r3RMNkh8QDiEym0n3GmV6/4VbOmtWkR7ARfu0RvfXm8GSD+
vwICMql/UWw1TeosYtb9ht/28AFCxy0qhnUmqoo/3Gte32xRiE2ngnhGmenfz+Gb
jivjxD3Wz0Lekm2OJWWmMEb3a6R+95IoDyE4A8yAzjRcmydZu8ESpatcMVh8G4pq
bQIDAQAB
-----END PUBLIC KEY-----`;

function aesEncrypt(plaintext: string, key: Buffer): string {
  const cipher = createCipheriv(`aes-${key.length * 8}-ecb`, key, null);
  return Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString(
    'base64',
  );
}

function decryptRequestBody(ciphertext: string): string {
  const decipher = createDecipheriv('aes-256-ecb', REQUEST_KEY, null);
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function encryptedResponse(payload: unknown): Response {
  const responseKey = Buffer.from(
    '0123456789abcdef0123456789abcdef',
    'utf8',
  );
  const encryptedKey = publicEncrypt(
    { key: RESPONSE_PUBLIC_KEY, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(responseKey.toString('base64'), 'utf8'),
  ).toString('base64');
  return new Response(aesEncrypt(JSON.stringify(payload), responseKey), {
    status: 200,
    headers: { 'encrypt-key': encryptedKey },
  });
}

test('parseNetshortEpisodePage extracts ID, episode, and locale', () => {
  assert.deepEqual(
    parseNetshortEpisodePage(
      'https://netshort.com/episode/dead-love-makes-no-tears-2084484326627127298',
    ),
    {
      shortPlayId: '2084484326627127298',
      episodeNo: 1,
      contentLanguage: 'en_US',
    },
  );
  assert.deepEqual(
    parseNetshortEpisodePage(
      'https://www.netshort.com/th/episode/example-2084484326627127298-ep-6?from=x',
    ),
    {
      shortPlayId: '2084484326627127298',
      episodeNo: 6,
      contentLanguage: 'th_TH',
    },
  );
  assert.equal(
    parseNetshortEpisodePage(
      'https://netshort.com/download/example-2084484326627127298',
    ),
    null,
  );
  assert.equal(
    parseNetshortEpisodePage(
      'https://netshort.com/a/b/episode/example-2084484326627127298',
    ),
    null,
  );
  assert.equal(
    parseNetshortEpisodePage(
      'https://netshort.com.evil.example/episode/example-2084484326627127298',
    ),
    null,
  );
});

test('request crypto matches module 97539 AES-256-ECB vector', () => {
  const body = {
    shortPlayId: '2084484326627127298',
    episodeNo: 1,
  };
  assert.equal(
    encryptNetshortRequestBody(body),
    'Njox+R35km4+1g3Kos17mPOlsut2JBpTtj+mQHwr8Iv0EEK1Oe9h9Ox0zSnfwzHBeHmfJXDPEKT+NR7azVQFuA==',
  );
  const rsaHeader = createNetshortEncryptKeyHeader();
  assert.equal(Buffer.from(rsaHeader, 'base64').length, 256);
});

test('resolveNetshortPlayUrl sends anonymous encrypted request and decrypts response', async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    calls += 1;
    assert.equal(
      String(input),
      'https://netshort.com/prod-web-api/web/v4/short_play/episode_info',
    );
    assert.equal(init?.method, 'POST');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Content-Language'), 'th_TH');
    assert.equal(headers.get('OS'), '4');
    assert.equal(headers.get('canary'), 'v1');
    assert.equal(headers.get('version'), '1.2.0');
    assert.equal(headers.get('Authorization'), null);
    assert.equal(headers.get('Device-Code'), null);
    assert.deepEqual(JSON.parse(decryptRequestBody(String(init?.body))), {
      shortPlayId: '2084484326627127298',
      episodeNo: 6,
    });
    return encryptedResponse({
      code: 200,
      msg: 'ok',
      data: {
        episodeId: 'episode-6',
        episodeNo: 6,
        playVoucher:
          'https://cfcdn.netshort.com/opaque-video?mime_type=video_mp4&auth_key=2000000000-x',
        isLock: false,
        duration: '233.125',
      },
    });
  };

  const result = await resolveNetshortPlayUrl(
    'https://netshort.com/th/episode/example-2084484326627127298-ep-6',
    { fetchImpl, timeoutMs: 1_000, bearerToken: '', deviceCode: '' },
  );
  assert.equal(calls, 1, 'free episode must not trigger visitor_login');
  assert.equal(result.shortPlayId, '2084484326627127298');
  assert.equal(result.episodeNo, 6);
  assert.equal(result.episodeId, 'episode-6');
  assert.equal(result.durationSec, 233.125);
  assert.match(result.playUrl, /^https:\/\/cfcdn\.netshort\.com\/opaque-video/);
});

test('resolveNetshortPlayUrl reports paid lock without attempting visitor login', async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        code: 200,
        msg: 'ok',
        data: { episodeNo: 9, playVoucher: null, isLock: true },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  await assert.rejects(
    () =>
      resolveNetshortPlayUrl(
        'https://netshort.com/episode/example-2084484326627127298-ep-9',
        { fetchImpl, timeoutMs: 1_000, bearerToken: '', deviceCode: '' },
      ),
    /第 9 集已锁定.*playVoucher/,
  );
  assert.equal(calls, 1);
});

test('resolver performs visitor_login only after an explicit 401', async () => {
  const paths: string[] = [];
  const authHeaders: Array<string | null> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    const headers = new Headers(init?.headers);
    authHeaders.push(headers.get('Authorization'));
    if (paths.length === 1) {
      return new Response(JSON.stringify({ code: 401, msg: 'login required' }), {
        status: 200,
      });
    }
    if (path.endsWith('/visitor_login')) {
      const loginBody = JSON.parse(decryptRequestBody(String(init?.body)));
      assert.equal(loginBody.os, 'windows');
      assert.equal(headers.get('Device-Code'), loginBody.deviceCode);
      return new Response(
        JSON.stringify({ code: 200, data: { token: 'visitor-token', timeout: 3600 } }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({
        code: 200,
        data: {
          isLock: false,
          playVoucher: 'https://cfcdn.netshort.com/from-visitor',
        },
      }),
      { status: 200 },
    );
  };

  const result = await resolveNetshortPlayUrl(
    'https://netshort.com/episode/example-2084484326627127298',
    { fetchImpl, timeoutMs: 1_000, bearerToken: '', deviceCode: '' },
  );
  assert.equal(result.playUrl, 'https://cfcdn.netshort.com/from-visitor');
  assert.deepEqual(paths, [
    '/prod-web-api/web/v4/short_play/episode_info',
    '/prod-web-api/web/auth/visitor_login',
    '/prod-web-api/web/v4/short_play/episode_info',
  ]);
  assert.deepEqual(authHeaders, [null, null, 'Bearer visitor-token']);
});

test('NetShort extensionless CDN URL is playable and auth_key drives expiry', () => {
  const url =
    'https://cfcdn.netshort.com/opaque?a=0&auth_key=2000000000-nonce&mime_type=video_mp4';
  assert.equal(isPlayableMediaUrl(url), true);
  assert.equal(
    isPlayableMediaUrl('https://evil.example/opaque?mime_type=video_mp4'),
    false,
  );
  assert.equal(inferExternalUrlExpiry(url)?.getTime(), 2_000_000_000_000);
});

test('YtdlpProvider returns an existing playVoucher without invoking yt-dlp', async () => {
  const provider = new YtdlpProvider({ get: () => undefined } as any);
  (provider as any).requireHttpUrl = async (value: string) => value;
  (provider as any).runText = async () => {
    throw new Error('yt-dlp must not run for a resolved NetShort CDN URL');
  };
  const url = 'https://cfcdn.netshort.com/opaque?mime_type=video_mp4';
  assert.equal(
    await provider.resolvePlayUrl(url, 'best_mp4', undefined, {
      bearerToken: 'must-not-leak',
    }),
    url,
  );
});

test('YtdlpProvider download does not forward API auth or playlist index to NetShort CDN', async () => {
  const provider = new YtdlpProvider({ get: () => undefined } as any);
  (provider as any).requireHttpUrl = async (value: string) => value;
  let capturedArgs: string[] = [];
  (provider as any).runText = async (args: string[]) => {
    capturedArgs = args;
    const template = args[args.indexOf('-o') + 1];
    const output = template.replace('%(ext)s', 'mp4');
    fs.writeFileSync(output, 'video');
    return output;
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netshort-download-'));
  try {
    const result = await provider.downloadToFile(
      'https://cfcdn.netshort.com/opaque?mime_type=video_mp4',
      dir,
      'best_mp4',
      7,
      { bearerToken: 'must-not-leak' },
    );
    assert.equal(fs.existsSync(result.absPath), true);
    assert.equal(capturedArgs.some((arg) => arg.includes('must-not-leak')), false);
    assert.equal(capturedArgs.includes('--playlist-items'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

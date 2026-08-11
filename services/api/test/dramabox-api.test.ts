import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildDramaboxSignPayload,
  parseDramaboxEpisodePage,
  resolveDramaboxPlayUrl,
  signDramaboxSn,
  signDramaboxSt,
} from '../src/admin/dramabox-api.util';

test('parseDramaboxEpisodePage extracts bookId and chapterId', () => {
  assert.deepEqual(
    parseDramaboxEpisodePage(
      'https://www.dramaboxapp.com/episode/42000021641/701325586',
    ),
    { bookId: '42000021641', chapterId: '701325586' },
  );
  assert.deepEqual(
    parseDramaboxEpisodePage(
      'https://dramabox.com/en/episode/42000021641/701325586?x=1',
    ),
    { bookId: '42000021641', chapterId: '701325586' },
  );
  assert.equal(
    parseDramaboxEpisodePage('https://www.dramaboxapp.com/drama/42000021641'),
    null,
  );
  assert.equal(
    parseDramaboxEpisodePage('https://netshort.com/episode/42000021641/1'),
    null,
  );
});

test('signDramaboxSt / Sn match captured intercept samples', () => {
  const fixturesPath = path.join(
    os.tmpdir(),
    'htk_mitm',
    'signer_samples.json',
  );
  if (!fs.existsSync(fixturesPath)) {
    // CI / clean machines without local MITM capture: self-consistency only.
    const payload = buildDramaboxSignPayload({
      timestampMs: '1700000000000',
      body: '{"bookId":"1"}',
      deviceId: '00000000-0000-4000-8000-000000000001',
      androidId: '0000000050ae4bb750ae4bb700000000',
      tn: 'Bearer test.token.value',
    });
    const st = signDramaboxSt(payload);
    const sn = signDramaboxSn(payload);
    assert.match(st, /^cK4n10B_0tTQBrxF[\w-]{8}$/);
    assert.equal(Buffer.from(sn, 'base64').length, 256);
    assert.equal(signDramaboxSt(''), 'cK4n10B_0tTQBrxFRR8J_Dle');
    return;
  }

  const samples = JSON.parse(fs.readFileSync(fixturesPath, 'utf8')) as Array<{
    timestamp: number | string;
    body: string;
    device_id: string;
    android_id: string;
    tn: string;
    st: string;
    sn: string;
  }>;
  assert.ok(samples.length >= 3);
  let stOk = 0;
  let snOk = 0;
  for (const s of samples) {
    const payload = buildDramaboxSignPayload({
      timestampMs: s.timestamp,
      body: s.body,
      deviceId: s.device_id,
      androidId: s.android_id,
      tn: s.tn,
    });
    if (signDramaboxSt(payload) === s.st) stOk++;
    if (signDramaboxSn(payload) === s.sn) snOk++;
  }
  assert.equal(stOk, samples.length);
  assert.equal(snOk, samples.length);
  assert.equal(signDramaboxSt(''), 'cK4n10B_0tTQBrxFRR8J_Dle');
});

test('resolveDramaboxPlayUrl posts signed batch/load and picks CDN path', async () => {
  const pageUrl =
    'https://www.dramaboxapp.com/episode/42000021641/701325586';
  let sawSn = false;
  let sawSt = false;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    assert.match(url, /\/drama-box\/chapterv2\/batch\/load\?timestamp=\d+/);
    assert.equal(init?.method, 'POST');
    const headers = new Headers(init?.headers);
    const sn = headers.get('sn') || '';
    const st = headers.get('st') || '';
    assert.equal(Buffer.from(sn, 'base64').length, 256);
    assert.match(st, /^cK4n10B_0tTQBrxF/);
    sawSn = true;
    sawSt = true;
    const body = JSON.parse(String(init?.body || '{}')) as {
      bookId?: string;
    };
    assert.equal(body.bookId, '42000021641');
    return new Response(
      JSON.stringify({
        status: 0,
        data: {
          bookId: '42000021641',
          chapterCount: 40,
          chapterList: [
            {
              chapterId: '701325586',
              chapterIndex: 0,
              cdnList: [
                {
                  isDefault: 1,
                  videoPathList: [
                    {
                      quality: 720,
                      videoPath:
                        'https://hwztvideo.dramaboxdb.com/x/701325586.encrypt.mp4?e=1',
                    },
                    {
                      quality: 1080,
                      videoPath:
                        'https://hwztvideo.dramaboxdb.com/x/701325586.1080p.encrypt.mp4?e=1',
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  const resolved = await resolveDramaboxPlayUrl(pageUrl, {
    bearerToken: 'Bearer test.jwt',
    deviceId: '81247fea-37da-46ae-b07b-5ca1cd86f8a3',
    androidId: '0000000050ae4bb750ae4bb700000000',
    fetchImpl,
  });
  assert.equal(
    resolved.playUrl,
    'https://hwztvideo.dramaboxdb.com/x/701325586.1080p.encrypt.mp4?e=1',
  );
  assert.equal(resolved.quality, 1080);
  assert.equal(resolved.chapterId, '701325586');
  assert.ok(sawSn && sawSt);
});

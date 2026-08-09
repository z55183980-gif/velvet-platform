import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { YtdlpProvider } from '../src/admin/ytdlp.provider';

function makeConfig(map: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => map[key],
  } as any;
}

test('YtdlpProvider refuses to exec env binary when YTDLP_SHA256 mismatches', async () => {
  const prevSha = process.env.YTDLP_SHA256;
  const prevNode = process.env.NODE_ENV;
  const prevAuto = process.env.YTDLP_AUTO_INSTALL;
  process.env.NODE_ENV = 'development';
  process.env.YTDLP_AUTO_INSTALL = 'false';

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-prov-'));
  const bin = path.join(dir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  // Small file — not a real binary; SHA will mismatch expected.
  fs.writeFileSync(bin, 'fake-bin');
  const wrong = '22'.repeat(32);
  process.env.YTDLP_SHA256 = wrong;

  const storage = path.join(dir, 'storage');
  fs.mkdirSync(storage, { recursive: true });

  try {
    const provider = new YtdlpProvider(
      makeConfig({
        YTDLP_ENABLED: 'true',
        YTDLP_AUTO_INSTALL: 'false',
        YTDLP_BIN: bin,
        YTDLP_BIN_DIR: path.join(storage, 'bin'),
        STORAGE_ROOT: storage,
      }),
    );
    const got = await provider.ensureReady();
    assert.equal(got, null, 'must not return unverified binary');
  } finally {
    if (prevSha === undefined) delete process.env.YTDLP_SHA256;
    else process.env.YTDLP_SHA256 = prevSha;
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
    if (prevAuto === undefined) delete process.env.YTDLP_AUTO_INSTALL;
    else process.env.YTDLP_AUTO_INSTALL = prevAuto;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

test('YtdlpProvider accepts env binary when SHA matches (then --version may still fail)', async () => {
  const prevSha = process.env.YTDLP_SHA256;
  const prevNode = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-prov-ok-'));
  const bin = path.join(dir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  const body = Buffer.from('#!/bin/sh\necho 2025.10.14\n');
  fs.writeFileSync(bin, body);
  try {
    fs.chmodSync(bin, 0o755);
  } catch {
    /* win */
  }
  process.env.YTDLP_SHA256 = createHash('sha256').update(body).digest('hex');

  const storage = path.join(dir, 'storage');
  fs.mkdirSync(path.join(storage, 'bin'), { recursive: true });

  try {
    const provider = new YtdlpProvider(
      makeConfig({
        YTDLP_ENABLED: 'true',
        YTDLP_AUTO_INSTALL: 'false',
        YTDLP_BIN: bin,
        YTDLP_BIN_DIR: path.join(storage, 'bin'),
        STORAGE_ROOT: storage,
      }),
    );
    // SHA passes; --version may succeed (shell script) or fail — must not throw.
    const got = await provider.ensureReady();
    // On Windows .exe fake won't run; on unix script may work.
    if (process.platform !== 'win32') {
      assert.equal(got, bin);
    } else {
      assert.ok(got === bin || got === null);
    }
  } finally {
    if (prevSha === undefined) delete process.env.YTDLP_SHA256;
    else process.env.YTDLP_SHA256 = prevSha;
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

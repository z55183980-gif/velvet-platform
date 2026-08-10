import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  expectedYtdlpSha256,
  verifyYtdlpSha256,
  ensureYtdlpBinary,
  ytdlpAssetName,
  YTDLP_DEFAULT_SHA256_LINUX_STANDALONE,
  YTDLP_DEFAULT_SHA256_MACOS,
  YTDLP_DEFAULT_SHA256_WIN,
} from '../src/admin/ytdlp-bootstrap.util';

test('verifyYtdlpSha256 rejects mismatch', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-'));
  const file = path.join(dir, 'yt-dlp');
  fs.writeFileSync(file, 'not-a-real-binary');
  assert.throws(() => verifyYtdlpSha256(file, '00'.repeat(32)), /sha256 mismatch/);
});

test('ensureYtdlpBinary re-verifies existing binary (does not skip SHA)', async () => {
  const prevSha = process.env.YTDLP_SHA256;
  const prevNode = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-bin-'));
  const dest = path.join(dir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  // Large enough to pass size gate, wrong hash → must re-download (which we block).
  fs.writeFileSync(dest, Buffer.alloc(1_000_001, 1));
  const wrong = '11'.repeat(32);
  process.env.YTDLP_SHA256 = wrong;
  // Point download base at a dead URL so re-download fails closed after checksum miss.
  const prevBase = process.env.YTDLP_DOWNLOAD_BASE;
  process.env.YTDLP_DOWNLOAD_BASE = 'https://127.0.0.1:1/nope';
  try {
    await assert.rejects(() => ensureYtdlpBinary({ binDir: dir, timeoutMs: 500 }), /./);
    assert.equal(fs.existsSync(dest), false, 'bad binary should be removed');
  } finally {
    if (prevSha === undefined) delete process.env.YTDLP_SHA256;
    else process.env.YTDLP_SHA256 = prevSha;
    if (prevBase === undefined) delete process.env.YTDLP_DOWNLOAD_BASE;
    else process.env.YTDLP_DOWNLOAD_BASE = prevBase;
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

test('ensureYtdlpBinary accepts existing binary when SHA matches', async () => {
  const prevSha = process.env.YTDLP_SHA256;
  const prevNode = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-ok-'));
  const dest = path.join(dir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  const body = Buffer.alloc(1_000_001, 2);
  fs.writeFileSync(dest, body);
  const hash = createHash('sha256').update(body).digest('hex');
  process.env.YTDLP_SHA256 = hash;
  try {
    const got = await ensureYtdlpBinary({ binDir: dir, timeoutMs: 500 });
    assert.equal(got, dest);
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

test('expectedYtdlpSha256 prefers env override', () => {
  const prev = process.env.YTDLP_SHA256;
  try {
    process.env.YTDLP_SHA256 = 'ab'.repeat(32);
    assert.equal(expectedYtdlpSha256(), 'ab'.repeat(32));
  } finally {
    if (prev === undefined) delete process.env.YTDLP_SHA256;
    else process.env.YTDLP_SHA256 = prev;
  }
});

test('linux/mac/win pin standalone assets (not zipimport on linux)', () => {
  assert.equal(ytdlpAssetName('linux'), 'yt-dlp_linux');
  assert.equal(ytdlpAssetName('darwin'), 'yt-dlp_macos');
  assert.equal(ytdlpAssetName('win32'), 'yt-dlp.exe');
  const prev = process.env.YTDLP_SHA256;
  try {
    delete process.env.YTDLP_SHA256;
    assert.equal(expectedYtdlpSha256('linux'), YTDLP_DEFAULT_SHA256_LINUX_STANDALONE);
    assert.equal(expectedYtdlpSha256('darwin'), YTDLP_DEFAULT_SHA256_MACOS);
    assert.equal(expectedYtdlpSha256('win32'), YTDLP_DEFAULT_SHA256_WIN);
  } finally {
    if (prev === undefined) delete process.env.YTDLP_SHA256;
    else process.env.YTDLP_SHA256 = prev;
  }
});

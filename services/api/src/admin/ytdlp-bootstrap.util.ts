import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { createHash } from 'crypto';
import { Logger } from '@nestjs/common';
import { isProductionEnv } from '../common/security-config';

const log = new Logger('YtdlpBootstrap');

/** Pinned release — never follow mutable /latest without an explicit override. */
export const YTDLP_DEFAULT_RELEASE_TAG = '2025.10.14';
/** SHA256 of official `yt-dlp` asset for YTDLP_DEFAULT_RELEASE_TAG (linux/mac zipimport). */
export const YTDLP_DEFAULT_SHA256_UNIX =
  '104d8103f871fe5f165a945ab82884fa4f34007a8ab0d377fbad54482b6e0b68';
/** SHA256 of official `yt-dlp.exe` for YTDLP_DEFAULT_RELEASE_TAG. */
export const YTDLP_DEFAULT_SHA256_WIN =
  '9ba4b80c9b64a7a2145c77c33b0208adaad34a650c73ea8373d64d6173ecd1a7';
/** SHA256 of official `yt-dlp_linux` standalone for Docker/glibc images. */
export const YTDLP_DEFAULT_SHA256_LINUX_STANDALONE =
  '83d2c55a8893b49d0ccd23f5c528acf06840fc59bd1100519832b60724af34b7';

function releaseTag(): string {
  return (process.env.YTDLP_RELEASE_TAG || YTDLP_DEFAULT_RELEASE_TAG).trim();
}

function releaseBase(): string {
  return (
    process.env.YTDLP_DOWNLOAD_BASE ||
    `https://github.com/yt-dlp/yt-dlp/releases/download/${releaseTag()}`
  );
}

/** 官方独立二进制（无需 Python），按平台选取资源名 */
export function ytdlpAssetName(platform = process.platform): string {
  if (platform === 'win32') return 'yt-dlp.exe';
  if (platform === 'darwin') return 'yt-dlp_macos';
  return 'yt-dlp';
}

export function ytdlpLocalFileName(platform = process.platform): string {
  return platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
}

export function defaultYtdlpBinDir(storageRoot?: string): string {
  const root =
    (storageRoot && storageRoot.trim()) ||
    path.join(process.cwd(), 'storage');
  return path.join(root, 'bin');
}

export function expectedYtdlpSha256(platform = process.platform): string {
  const fromEnv = (process.env.YTDLP_SHA256 || '').trim().toLowerCase();
  if (fromEnv) return fromEnv;
  if (platform === 'win32') return YTDLP_DEFAULT_SHA256_WIN;
  return YTDLP_DEFAULT_SHA256_UNIX;
}

export function verifyYtdlpSha256(filePath: string, expectedSha: string): void {
  const want = expectedSha.trim().toLowerCase();
  if (!want) {
    throw new Error('yt-dlp sha256 required but empty');
  }
  const hash = createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  if (hash !== want) {
    throw new Error(`yt-dlp sha256 mismatch (got ${hash}, expected ${want})`);
  }
}

function downloadToFile(url: string, dest: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const tmp = `${dest}.download`;
    const follow = (current: string, redirectsLeft: number) => {
      const lib = current.startsWith('https') ? https : http;
      const req = lib.get(
        current,
        {
          headers: { 'User-Agent': 'velvet-api-ytdlp-bootstrap' },
          timeout: timeoutMs,
        },
        (res) => {
          const code = res.statusCode || 0;
          if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
            res.resume();
            if (redirectsLeft <= 0) {
              reject(new Error('too many redirects'));
              return;
            }
            const next = new URL(res.headers.location, current).toString();
            follow(next, redirectsLeft - 1);
            return;
          }
          if (code !== 200) {
            res.resume();
            reject(new Error(`HTTP ${code} downloading yt-dlp`));
            return;
          }
          const out = fs.createWriteStream(tmp);
          res.pipe(out);
          out.on('finish', () => {
            out.close(() => {
              try {
                fs.renameSync(tmp, dest);
                resolve();
              } catch (e) {
                reject(e);
              }
            });
          });
          out.on('error', (e) => {
            try {
              fs.unlinkSync(tmp);
            } catch {
              /* ignore */
            }
            reject(e);
          });
        },
      );
      req.on('timeout', () => {
        req.destroy(new Error('download timeout'));
      });
      req.on('error', reject);
    };
    follow(url, 8);
  });
}

function requireShaOrThrow(): string {
  const sha = (process.env.YTDLP_SHA256 || '').trim().toLowerCase();
  if (sha) return sha;
  if (isProductionEnv()) {
    throw new Error(
      'YTDLP_SHA256 is required in production — refuse unverified yt-dlp binary',
    );
  }
  // Dev/test: fall back to pinned default for the default release tag only.
  if (releaseTag() === YTDLP_DEFAULT_RELEASE_TAG) {
    return expectedYtdlpSha256();
  }
  throw new Error(
    'YTDLP_SHA256 unset for non-default YTDLP_RELEASE_TAG — set checksum explicitly',
  );
}

/**
 * 若目标路径没有可用二进制，则从 GitHub Releases 下载官方 yt-dlp。
 * 始终校验 SHA256（生产强制要求 YTDLP_SHA256；已有二进制也会复验）。
 */
export async function ensureYtdlpBinary(opts: {
  binDir: string;
  timeoutMs?: number;
}): Promise<string> {
  const binDir = opts.binDir;
  const fileName = ytdlpLocalFileName();
  const dest = path.join(binDir, fileName);
  fs.mkdirSync(binDir, { recursive: true });
  const expectedSha = requireShaOrThrow();

  if (fs.existsSync(dest)) {
    const st = fs.statSync(dest);
    if (st.size > 1_000_000) {
      try {
        verifyYtdlpSha256(dest, expectedSha);
      } catch (e) {
        log.warn(`Existing yt-dlp failed checksum — re-downloading (${(e as Error).message})`);
        try {
          fs.unlinkSync(dest);
        } catch {
          /* ignore */
        }
      }
      if (fs.existsSync(dest)) {
        if (process.platform !== 'win32') {
          try {
            fs.chmodSync(dest, 0o755);
          } catch {
            /* ignore */
          }
        }
        return dest;
      }
    }
  }

  const asset = ytdlpAssetName();
  const url = `${releaseBase().replace(/\/+$/, '')}/${asset}`;
  if (/\/latest\/download/i.test(url) && !process.env.YTDLP_ALLOW_LATEST) {
    throw new Error(
      'Refusing mutable yt-dlp /latest download; set YTDLP_RELEASE_TAG or YTDLP_ALLOW_LATEST=1',
    );
  }
  const timeoutMs = opts.timeoutMs ?? 120_000;
  log.log(`Downloading yt-dlp from ${url} → ${dest}`);
  await downloadToFile(url, dest, timeoutMs);
  if (process.platform !== 'win32') {
    fs.chmodSync(dest, 0o755);
  }
  const st = fs.statSync(dest);
  if (st.size < 1_000_000) {
    try {
      fs.unlinkSync(dest);
    } catch {
      /* ignore */
    }
    throw new Error(`downloaded yt-dlp looks too small (${st.size} bytes)`);
  }
  try {
    verifyYtdlpSha256(dest, expectedSha);
  } catch (e) {
    try {
      fs.unlinkSync(dest);
    } catch {
      /* ignore */
    }
    throw e;
  }
  log.log(`yt-dlp ready at ${dest} (${Math.round(st.size / 1024 / 1024)}MB)`);
  return dest;
}

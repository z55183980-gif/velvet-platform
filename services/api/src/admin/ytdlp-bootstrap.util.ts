import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { createHash } from 'crypto';
import { Logger } from '@nestjs/common';

const log = new Logger('YtdlpBootstrap');

/** Pinned release — never follow mutable /latest without an explicit override. */
const RELEASE_TAG = (process.env.YTDLP_RELEASE_TAG || '2025.10.14').trim();
const RELEASE_BASE =
  process.env.YTDLP_DOWNLOAD_BASE ||
  `https://github.com/yt-dlp/yt-dlp/releases/download/${RELEASE_TAG}`;

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

/**
 * 若目标路径没有可用二进制，则从 GitHub Releases 下载官方 yt-dlp。
 * 返回最终绝对路径；失败抛错。
 */
export async function ensureYtdlpBinary(opts: {
  binDir: string;
  timeoutMs?: number;
}): Promise<string> {
  const binDir = opts.binDir;
  const fileName = ytdlpLocalFileName();
  const dest = path.join(binDir, fileName);
  fs.mkdirSync(binDir, { recursive: true });

  if (fs.existsSync(dest)) {
    const st = fs.statSync(dest);
    if (st.size > 1_000_000) {
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

  const asset = ytdlpAssetName();
  const url = `${RELEASE_BASE.replace(/\/+$/, '')}/${asset}`;
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
    throw new Error(`downloaded yt-dlp looks too small (${st.size} bytes)`);
  }
  const expectedSha = (process.env.YTDLP_SHA256 || '').trim().toLowerCase();
  if (expectedSha) {
    const hash = createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
    if (hash !== expectedSha) {
      try {
        fs.unlinkSync(dest);
      } catch {
        /* ignore */
      }
      throw new Error(
        `yt-dlp sha256 mismatch (got ${hash}, expected ${expectedSha})`,
      );
    }
  } else {
    log.warn(
      'YTDLP_SHA256 unset — version is pinned but checksum not verified; set YTDLP_SHA256 in production',
    );
  }
  log.log(`yt-dlp ready at ${dest} (${Math.round(st.size / 1024 / 1024)}MB)`);
  return dest;
}

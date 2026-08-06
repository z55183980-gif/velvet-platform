import { Controller, Get, Req, Res, ForbiddenException, NotFoundException, Query } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { rewriteSignedPlaylist, verifyMediaSig } from '../common/media-sign.util';

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.m4v': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.3gp': 'video/3gpp',
  '.3g2': 'video/3gpp2',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.f4v': 'video/x-f4v',
  '.m2ts': 'video/mp2t',
  '.mts': 'video/mp2t',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.ogv': 'video/ogg',
  '.asf': 'video/x-ms-asf',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

const VIDEO_EXTS = new Set([
  '.mp4',
  '.webm',
  '.mov',
  '.mkv',
  '.m4v',
  '.avi',
  '.3gp',
  '.3g2',
  '.wmv',
  '.flv',
  '.f4v',
  '.m2ts',
  '.mts',
  '.mpg',
  '.mpeg',
  '.ogv',
  '.asf',
  '.m3u8',
  '.ts',
]);

/**
 * 本地媒体静态服务。
 * 查找顺序：STORAGE_ROOT → MEDIA_ROOT
 * 视频类资源必须带短时签名 ?sig=&exp=；封面图可公开。
 */
@Controller('v1/media')
@SkipThrottle()
export class MediaController {
  constructor(private readonly config: ConfigService) {}

  private roots(): string[] {
    const list: string[] = [];
    const storage =
      this.config.get<string>('STORAGE_ROOT') || path.join(process.cwd(), 'storage');
    if (storage) list.push(path.resolve(storage));
    const media = this.config.get<string>('MEDIA_ROOT');
    if (media) list.push(path.resolve(media));
    const importRoot = this.config.get<string>('ADMIN_IMPORT_ROOT');
    if (importRoot) list.push(path.resolve(importRoot));
    // 去重，保留顺序
    return [...new Set(list)];
  }

  @Get('*')
  serve(
    @Req() req: Request,
    @Res() res: Response,
    @Query('sig') sig?: string,
    @Query('exp') exp?: string,
  ) {
    const roots = this.roots();
    if (!roots.length) throw new NotFoundException('media disabled');

    const urlPath = (req.url || '').split('?')[0];
    const prefix = '/api/v1/media/';
    const relRaw = urlPath.startsWith(prefix)
      ? urlPath.slice(prefix.length)
      : urlPath.replace(/^\/+/, '');
    const rel = decodeURIComponent(relRaw);
    const normalized = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');

    let abs: string | null = null;
    let matchedRoot: string | null = null;
    for (const root of roots) {
      const candidate = path.join(root, normalized);
      if (candidate !== root && !candidate.startsWith(root + path.sep)) continue;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        abs = candidate;
        matchedRoot = root;
        break;
      }
    }
    if (!abs || !matchedRoot) throw new NotFoundException('not found');

    const ext = path.extname(abs).toLowerCase();
    if (VIDEO_EXTS.has(ext)) {
      const key = this.config.get<string>('CDN_SIGN_KEY') || 'dev';
      if (!verifyMediaSig(normalized.replace(/\\/g, '/'), exp, sig, key)) {
        throw new ForbiddenException('invalid or expired media signature');
      }
    }

    const mime = MIME[ext] || 'application/octet-stream';
    const posixRel = normalized.replace(/\\/g, '/');
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', VIDEO_EXTS.has(ext) ? 'private, max-age=60' : 'public, max-age=3600');

    // HLS 播放列表：相对分片/子清单补 path 绑定签名，否则浏览器二次请求无 sig → 403
    if (ext === '.m3u8') {
      const key = this.config.get<string>('CDN_SIGN_KEY') || 'dev';
      const expN = typeof exp === 'string' ? parseInt(exp, 10) : Number(exp);
      const raw = fs.readFileSync(abs, 'utf8');
      const rewritten = rewriteSignedPlaylist(raw, posixRel, expN, key);
      const buf = Buffer.from(rewritten, 'utf8');
      res.setHeader('Content-Length', buf.length);
      res.setHeader('Accept-Ranges', 'none');
      res.status(200).end(buf);
      return;
    }

    const stat = fs.statSync(abs);
    const range = req.headers.range as string | undefined;
    res.setHeader('Accept-Ranges', 'bytes');

    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (isNaN(start) || isNaN(end) || start > end || end >= stat.size) {
        end = stat.size - 1;
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      res.setHeader('Content-Length', end - start + 1);
      fs.createReadStream(abs, { start, end }).pipe(res);
    } else {
      res.setHeader('Content-Length', stat.size);
      fs.createReadStream(abs).pipe(res);
    }
  }
}

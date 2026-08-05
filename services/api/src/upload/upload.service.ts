import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import { R2StorageService } from '../storage/r2.storage.service';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface UploadResult {
  relativePath: string;
  originalUrl: string;
  filename: string;
  size: number;
  mime: string;
}

export interface TranscodeJob {
  id: string;
  episodeId?: string;
  inputRel: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  outputRel?: string;
  error?: string;
  createdAt: number;
}

@Injectable()
export class UploadService implements OnModuleInit {
  private readonly logger = new Logger(UploadService.name);
  private ffmpegPath: string | null = null;
  private readonly jobs = new Map<string, TranscodeJob>();
  private running = false;
  private readonly queue: string[] = [];

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly r2: R2StorageService,
  ) {}

  onModuleInit() {
    this.detectFfmpeg().catch(() => undefined);
  }

  /** 上传落盘目录：优先 STORAGE_ROOT/uploads，否则 cwd/storage/uploads */
  getStorageRoot(): string {
    const root =
      this.config.get<string>('STORAGE_ROOT') ||
      path.join(process.cwd(), 'storage');
    return path.resolve(root);
  }

  getUploadDir(): string {
    const dir = path.join(this.getStorageRoot(), 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  getHlsDir(): string {
    const dir = path.join(this.getStorageRoot(), 'hls');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  async detectFfmpeg(): Promise<string | null> {
    if (this.ffmpegPath) return this.ffmpegPath;
    const candidates = [
      this.config.get<string>('FFMPEG_PATH'),
      'ffmpeg',
      '/opt/homebrew/bin/ffmpeg',
      '/usr/local/bin/ffmpeg',
      '/usr/bin/ffmpeg',
    ].filter(Boolean) as string[];
    for (const bin of candidates) {
      try {
        await execFileAsync(bin, ['-version'], { timeout: 5000 });
        this.ffmpegPath = bin;
        this.logger.log(`ffmpeg detected: ${bin}`);
        return bin;
      } catch {
        /* try next */
      }
    }
    this.logger.warn('ffmpeg not found — transcode will fail until installed');
    return null;
  }

  saveUpload(file: Express.Multer.File): UploadResult {
    if (!file) throw new BizException(BizCode.BAD_REQUEST, '未收到文件');
    const ext = path.extname(file.originalname || '').toLowerCase() || '.mp4';
    const allowed = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v']);
    if (!allowed.has(ext)) {
      throw new BizException(BizCode.BAD_REQUEST, `不支持的格式: ${ext}`);
    }
    const mimeByExt: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.mkv': 'video/x-matroska',
      '.webm': 'video/webm',
      '.m4v': 'video/x-m4v',
    };
    const rawMime = file.mimetype || '';
    const mime =
      !rawMime || rawMime === 'application/octet-stream'
        ? mimeByExt[ext] || 'video/mp4'
        : rawMime;
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const filename = `${Date.now()}-${id}${ext}`;
    const abs = path.join(this.getUploadDir(), filename);
    fs.writeFileSync(abs, file.buffer);
    const relativePath = `uploads/${filename}`;
    return {
      relativePath,
      originalUrl: relativePath,
      filename,
      size: file.size,
      mime,
    };
  }

  /** KYC 文档类上传（jpg/png/webp，5MB 限制） */
  saveDocument(file: Express.Multer.File, kind: 'cccd-front' | 'cccd-back' | 'avatar'): UploadResult {
    if (!file) throw new BizException(BizCode.BAD_REQUEST, '未收到文件');
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp']);
    if (!allowed.has(ext)) {
      throw new BizException(BizCode.BAD_REQUEST, `不支持的图片格式: ${ext || '(无扩展名)'}`);
    }
    const dir = path.join(this.getStorageRoot(), 'docs');
    fs.mkdirSync(dir, { recursive: true });
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const filename = `${kind}-${Date.now()}-${id}${ext}`;
    const abs = path.join(dir, filename);
    fs.writeFileSync(abs, file.buffer);
    const relativePath = `docs/${filename}`;
    const mimeByExt: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
    };
    return {
      relativePath,
      originalUrl: relativePath,
      filename,
      size: file.size,
      mime: file.mimetype || mimeByExt[ext] || 'image/jpeg',
    };
  }

  /** 封面/缩略图上传 → STORAGE_ROOT/covers（实例本地存储，经 /api/v1/media 访问） */
  saveImage(file: Express.Multer.File, kind: 'cover' | 'thumbnail' | 'image' = 'cover'): UploadResult {
    if (!file) throw new BizException(BizCode.BAD_REQUEST, '未收到文件');
    let ext = path.extname(file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    if (!ext || ext === '.') {
      if (mime === 'image/png') ext = '.png';
      else if (mime === 'image/webp') ext = '.webp';
      else ext = '.jpg';
    }
    const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp']);
    if (!allowed.has(ext)) {
      throw new BizException(BizCode.BAD_REQUEST, `不支持的图片格式: ${ext}`);
    }
    if (mime && !['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'].includes(mime)) {
      throw new BizException(BizCode.BAD_REQUEST, `mime 无效: ${mime}`);
    }
    const dir = path.join(this.getStorageRoot(), 'covers');
    fs.mkdirSync(dir, { recursive: true });
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const filename = `${kind}-${Date.now()}-${id}${ext === '.jpeg' ? '.jpg' : ext}`;
    const abs = path.join(dir, filename);
    fs.writeFileSync(abs, file.buffer);
    const relativePath = `covers/${filename}`;
    const mimeByExt: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
    };
    return {
      relativePath,
      originalUrl: relativePath,
      filename,
      size: file.size,
      mime: mime && mime !== 'application/octet-stream' ? mime : mimeByExt[ext] || 'image/jpeg',
    };
  }

  resolveAbs(relativePath: string): string {
    const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
    // storage 内
    const inStorage = path.join(this.getStorageRoot(), normalized);
    if (fs.existsSync(inStorage)) return inStorage;
    // MEDIA_ROOT 回退（样片）
    const mediaRoot = this.config.get<string>('MEDIA_ROOT');
    if (mediaRoot) {
      const inMedia = path.join(mediaRoot, normalized);
      if (fs.existsSync(inMedia)) return inMedia;
    }
    return inStorage;
  }

  enqueueTranscode(inputRel: string, episodeId?: string): TranscodeJob {
    const id = crypto.randomUUID();
    const job: TranscodeJob = {
      id,
      episodeId,
      inputRel,
      status: 'queued',
      createdAt: Date.now(),
    };
    this.jobs.set(id, job);
    this.queue.push(id);
    this.pump();
    return job;
  }

  getJob(id: string) {
    return this.jobs.get(id) || null;
  }

  private pump() {
    if (this.running) return;
    const next = this.queue.shift();
    if (!next) return;
    this.running = true;
    this.runJob(next)
      .catch((e) => this.logger.error(e))
      .finally(() => {
        this.running = false;
        this.pump();
      });
  }

  private async runJob(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = 'processing';

    if (job.episodeId) {
      await this.prisma.episode
        .update({
          where: { id: BigInt(job.episodeId) },
          data: { transcodeStatus: 'PROCESSING' },
        })
        .catch(() => undefined);
    }

    const ffmpeg = await this.detectFfmpeg();
    if (!ffmpeg) {
      job.status = 'failed';
      job.error = 'ffmpeg not found';
      if (job.episodeId) {
        await this.prisma.episode
          .update({
            where: { id: BigInt(job.episodeId) },
            data: { transcodeStatus: 'FAILED' },
          })
          .catch(() => undefined);
      }
      return;
    }

    const inputAbs = this.resolveAbs(job.inputRel);
    if (!fs.existsSync(inputAbs)) {
      job.status = 'failed';
      job.error = 'input missing';
      return;
    }

    const outDir = path.join(this.getHlsDir(), jobId);
    fs.mkdirSync(outDir, { recursive: true });
    const playlist = path.join(outDir, 'index.m3u8');
    const outputRel = `hls/${jobId}/index.m3u8`;

    try {
      await this.execFfmpeg(ffmpeg, inputAbs, playlist);
      job.status = 'completed';
      job.outputRel = outputRel;
      const durationSec = await this.probeDurationSec(ffmpeg, inputAbs);

      let hlsUrl: string = outputRel;
      if (this.r2.isEnabled()) {
        try {
          const prefix = `hls/${job.episodeId || jobId}`;
          hlsUrl = await this.r2.uploadHlsDirectory(outDir, prefix);
          this.logger.log(`transcode uploaded to R2 → ${hlsUrl}`);
        } catch (uploadErr: any) {
          this.logger.error(
            `R2 upload failed, keeping local hlsUrl: ${uploadErr?.message || uploadErr}`,
          );
        }
      }

      if (job.episodeId) {
        await this.prisma.episode.update({
          where: { id: BigInt(job.episodeId) },
          data: {
            hlsUrl,
            transcodeStatus: 'COMPLETED',
            uploadStatus: 'COMPLETED',
            ...(durationSec != null ? { durationSec } : {}),
          },
        });
      }
      this.logger.log(`transcode ok job=${jobId} → ${hlsUrl} duration=${durationSec ?? '?'}`);
    } catch (e: any) {
      job.status = 'failed';
      job.error = e?.message || String(e);
      if (job.episodeId) {
        await this.prisma.episode
          .update({
            where: { id: BigInt(job.episodeId) },
            data: { transcodeStatus: 'FAILED' },
          })
          .catch(() => undefined);
      }
      this.logger.error(`transcode fail job=${jobId}: ${job.error}`);
    }
  }

  private async probeDurationSec(ffmpegBin: string, inputAbs: string): Promise<number | null> {
    try {
      // 优先 ffprobe（同目录），否则 ffmpeg -i 解析 Duration
      const probe = ffmpegBin.replace(/ffmpeg$/, 'ffprobe');
      try {
        const { stdout } = await execFileAsync(
          probe,
          [
            '-v',
            'error',
            '-show_entries',
            'format=duration',
            '-of',
            'default=noprint_wrappers=1:nokey=1',
            inputAbs,
          ],
          { timeout: 15000 },
        );
        const sec = Math.round(parseFloat(String(stdout).trim()));
        if (Number.isFinite(sec) && sec > 0) return sec;
      } catch {
        /* fall through */
      }
      const { stderr } = await execFileAsync(ffmpegBin, ['-i', inputAbs], {
        timeout: 15000,
      }).catch((e: any) => ({ stderr: e?.stderr || e?.message || '' }));
      const m = String(stderr).match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!m) return null;
      const sec =
        parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + Math.round(parseFloat(m[3]));
      return sec > 0 ? sec : null;
    } catch {
      return null;
    }
  }

  private execFfmpeg(bin: string, input: string, playlist: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        '-y',
        '-i',
        input,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-c:a',
        'aac',
        '-ac',
        '2',
        '-f',
        'hls',
        '-hls_time',
        '6',
        '-hls_list_size',
        '0',
        '-hls_segment_filename',
        path.join(path.dirname(playlist), 'seg_%03d.ts'),
        playlist,
      ];
      const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`));
      });
    });
  }
}

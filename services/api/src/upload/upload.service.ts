import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import { R2StorageService } from '../storage/r2.storage.service';
import { VIDEO_EXT, VIDEO_MIME_BY_EXT } from '../admin/local-import.util';
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
  /** true=push R2 after HLS; false=keep local; undefined=follow STORAGE_BACKEND */
  preferR2?: boolean;
}

type JobDispatcher = (jobId: string) => Promise<void>;

@Injectable()
export class UploadService implements OnModuleInit {
  private readonly logger = new Logger(UploadService.name);
  private ffmpegPath: string | null = null;
  private readonly jobs = new Map<string, TranscodeJob>();
  private running = false;
  private readonly queue: string[] = [];
  /** When true, this process runs the legacy in-memory pump (no Redis). */
  private inlinePump = true;
  /** BullMQ (or other) enqueue hook; set by TranscodeQueueService. */
  private dispatcher: JobDispatcher | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly r2: R2StorageService,
  ) {}

  async onModuleInit() {
    await this.detectFfmpeg().catch(() => undefined);
    // Pending job recovery is driven by TranscodeQueueService after dispatcher wiring.
  }

  setJobDispatcher(dispatcher: JobDispatcher | null) {
    this.dispatcher = dispatcher;
  }

  enableInlinePump(enabled: boolean) {
    this.inlinePump = enabled;
  }

  isInlinePumpEnabled() {
    return this.inlinePump;
  }

  /** Recover QUEUED/PROCESSING rows; optional `dispatch` overrides default enqueue. */
  async recoverPendingJobs(dispatch?: (jobId: string) => Promise<void>) {
    const recoverable = await this.prisma.mediaTranscodeJob.findMany({
      where: { status: { in: ['QUEUED', 'PROCESSING'] } },
      orderBy: { createdAt: 'asc' },
    });
    if (!recoverable.length) return;
    await this.prisma.mediaTranscodeJob.updateMany({
      where: { id: { in: recoverable.map((job) => job.id) } },
      data: { status: 'QUEUED', startedAt: null },
    });
    for (const saved of recoverable) {
      this.jobs.set(saved.id, {
        id: saved.id,
        episodeId: saved.episodeId?.toString(),
        inputRel: saved.inputRel,
        status: 'queued',
        createdAt: saved.createdAt.getTime(),
        preferR2: saved.preferR2 ?? undefined,
      });
      if (dispatch) {
        await dispatch(saved.id);
      } else {
        await this.dispatchJob(saved.id);
      }
    }
    this.logger.log(`recovered ${recoverable.length} transcode job(s)`);
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
    if (!VIDEO_EXT.has(ext)) {
      throw new BizException(BizCode.BAD_REQUEST, `不支持的格式: ${ext}`);
    }
    const rawMime = file.mimetype || '';
    const mime =
      !rawMime || rawMime === 'application/octet-stream'
        ? VIDEO_MIME_BY_EXT[ext] || 'video/mp4'
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

  /** 封面/缩略图上传 → STORAGE_ROOT/covers；R2 开启时同步推送到 velvet-media */
  async saveImage(
    file: Express.Multer.File,
    kind: 'cover' | 'thumbnail' | 'image' = 'cover',
  ): Promise<UploadResult & { url: string }> {
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
    const resolvedMime =
      mime && mime !== 'application/octet-stream' ? mime : mimeByExt[ext] || 'image/jpeg';
    const base: UploadResult & { url: string } = {
      relativePath,
      originalUrl: relativePath,
      filename,
      size: file.size,
      mime: resolvedMime,
      // Covers/thumbnails always use local media path for admin/web <img>.
      // CDN Worker requires ?sig=&exp= for every object — bare CDN URLs break previews.
      url: `/api/v1/media/${relativePath}`,
    };
    if (this.r2.isEnabled() && this.r2.hasCredentials()) {
      try {
        const key = relativePath;
        await this.r2.putFile(this.r2.mediaBucket(), key, abs, resolvedMime);
        // Keep url on /api/v1/media/… ; R2 is a mirror for durability / future signed CDN reads.
        this.logger.log(`image mirrored to R2 ${this.r2.mediaBucket()}/${key} (url stays media path)`);
      } catch (e: any) {
        this.logger.error(`R2 image upload failed, keeping local: ${e?.message || e}`);
      }
    }
    return base;
  }

  storageStatus() {
    return {
      storageBackend: (this.config.get<string>('STORAGE_BACKEND') || 'local').toLowerCase(),
      r2Enabled: this.r2.isEnabled(),
      r2Configured: this.r2.hasCredentials(),
      r2DirectUpload: this.r2.canDirectUpload(),
      mediaBucket: this.r2.mediaBucket(),
      uploadBucket: this.r2.uploadBucket(),
      cdnBase: this.r2.cdnBase(),
      ffmpegReady: !!this.ffmpegPath,
      transcodeQueue: this.dispatcher && !this.inlinePump ? 'bullmq' : 'inline',
      redisConfigured: !!(
        this.config.get<string>('REDIS_URL') || process.env.REDIS_URL
      )?.trim(),
    };
  }

  /** Config flags + live R2 ListObjectsV2 probe (skipped when local / unconfigured). */
  async storageProbe() {
    const status = this.storageStatus();
    const probe = await this.r2.probeConnectivity();
    return {
      ...status,
      probe,
    };
  }

  async createPresignedDirectUpload(opts: {
    filename: string;
    contentType?: string;
    actorId?: bigint;
  }) {
    if (!this.r2.canDirectUpload()) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        'R2 未配置凭证，无法直传。请设置 R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY',
      );
    }
    const filename = opts.filename || 'video.mp4';
    const ext = path.extname(filename).toLowerCase() || '.mp4';
    if (!VIDEO_EXT.has(ext)) {
      throw new BizException(BizCode.BAD_REQUEST, `不支持的格式: ${ext}`);
    }
    const contentType =
      (opts.contentType || '').trim() || VIDEO_MIME_BY_EXT[ext] || 'application/octet-stream';
    return this.r2.createPresignedPut({
      filename,
      contentType,
      actorId: opts.actorId,
    });
  }

  /**
   * After browser PUT to velvet-uploads: verify object, download to local uploads/, return path for transcode.
   */
  async ingestDirectUploadKey(key: string, originalFilename?: string): Promise<UploadResult> {
    if (!this.r2.canDirectUpload()) {
      throw new BizException(BizCode.BAD_REQUEST, 'R2 未配置，无法接收直传对象');
    }
    if (!this.r2.isDirectUploadKey(key)) {
      throw new BizException(BizCode.BAD_REQUEST, '非法上传 key');
    }

    let head: { size: number; contentType?: string };
    try {
      head = await this.r2.headUploadObject(key);
    } catch {
      throw new BizException(BizCode.BAD_REQUEST, 'R2 上未找到上传对象，请确认浏览器 PUT 成功');
    }
    if (!head.size || head.size <= 0) {
      throw new BizException(BizCode.BAD_REQUEST, '上传对象为空');
    }
    const maxBytes = 512 * 1024 * 1024;
    if (head.size > maxBytes) {
      throw new BizException(BizCode.BAD_REQUEST, '文件过大（上限 512MB）');
    }

    const srcName = originalFilename || path.posix.basename(key);
    const ext = path.extname(srcName).toLowerCase() || '.mp4';
    if (!VIDEO_EXT.has(ext)) {
      throw new BizException(BizCode.BAD_REQUEST, `不支持的格式: ${ext}`);
    }

    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const filename = `${Date.now()}-${id}${ext}`;
    const abs = path.join(this.getUploadDir(), filename);
    await this.r2.downloadUploadObjectToFile(key, abs);
    const relativePath = `uploads/${filename}`;
    // Best-effort cleanup of temp object in upload bucket
    void this.r2.deleteUploadObject(key);

    return {
      relativePath,
      originalUrl: relativePath,
      filename,
      size: fs.statSync(abs).size,
      mime: head.contentType || VIDEO_MIME_BY_EXT[ext] || 'video/mp4',
    };
  }

  /** Remove local files + R2 objects for episode media URLs. */
  async purgeMediaUrls(urls: Array<string | null | undefined>): Promise<{
    r2Deleted: number;
    localDeleted: number;
  }> {
    let localDeleted = 0;
    for (const url of urls) {
      if (!url?.trim()) continue;
      const raw = url.trim();
      if (/^https?:\/\//i.test(raw)) continue;
      const rel = raw.replace(/^\/api\/v1\/media\//, '').replace(/^\/+/, '');
      if (!rel || rel.includes('..')) continue;
      const abs = this.resolveAbs(rel);
      try {
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
          fs.unlinkSync(abs);
          localDeleted += 1;
          // also remove sibling HLS directory when pointing at playlist
          if (rel.endsWith('.m3u8')) {
            const dir = path.dirname(abs);
            if (fs.existsSync(dir) && dir.startsWith(this.getStorageRoot())) {
              fs.rmSync(dir, { recursive: true, force: true });
            }
          }
        } else if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
          fs.rmSync(abs, { recursive: true, force: true });
          localDeleted += 1;
        }
      } catch (e: any) {
        this.logger.warn(`local purge failed for ${rel}: ${e?.message || e}`);
      }
    }
    let r2Deleted = 0;
    try {
      r2Deleted = await this.r2.purgeUrls(urls);
    } catch (e: any) {
      this.logger.error(`R2 purge failed: ${e?.message || e}`);
    }
    return { r2Deleted, localDeleted };
  }

  async listEpisodeR2Objects(hlsUrl: string | null | undefined) {
    const prefix = this.r2.mediaPrefixFromUrl(hlsUrl);
    if (!prefix || !this.r2.hasCredentials()) {
      return { prefix: prefix || null, objects: [] as { key: string; size: number; lastModified?: string }[] };
    }
    const objects = await this.r2.listPrefix(prefix);
    return { prefix, objects };
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

  async enqueueTranscode(
    inputRel: string,
    episodeId?: string,
    opts?: { preferR2?: boolean },
  ): Promise<TranscodeJob> {
    const id = crypto.randomUUID();
    const job: TranscodeJob = {
      id,
      episodeId,
      inputRel,
      status: 'queued',
      createdAt: Date.now(),
      preferR2: opts?.preferR2,
    };
    await this.prisma.mediaTranscodeJob.create({
      data: {
        id,
        episodeId: episodeId ? BigInt(episodeId) : null,
        inputRel,
        status: 'QUEUED',
        preferR2: opts?.preferR2,
      },
    });
    this.jobs.set(id, job);
    await this.dispatchJob(id);
    return job;
  }

  async getJob(id: string) {
    const active = this.jobs.get(id);
    if (active) return active;
    const saved = await this.prisma.mediaTranscodeJob.findUnique({ where: { id } });
    if (!saved) return null;
    return {
      id: saved.id,
      episodeId: saved.episodeId?.toString(),
      inputRel: saved.inputRel,
      status: saved.status.toLowerCase() as TranscodeJob['status'],
      outputRel: saved.outputRel ?? undefined,
      error: saved.error ?? undefined,
      createdAt: saved.createdAt.getTime(),
      preferR2: saved.preferR2 ?? undefined,
    };
  }

  /** Ensure in-memory job mirror exists (needed for BullMQ workers / recover). */
  private async hydrateJob(jobId: string): Promise<TranscodeJob | null> {
    const existing = this.jobs.get(jobId);
    if (existing) return existing;
    const saved = await this.prisma.mediaTranscodeJob.findUnique({ where: { id: jobId } });
    if (!saved) return null;
    const job: TranscodeJob = {
      id: saved.id,
      episodeId: saved.episodeId?.toString(),
      inputRel: saved.inputRel,
      status: saved.status.toLowerCase() as TranscodeJob['status'],
      outputRel: saved.outputRel ?? undefined,
      error: saved.error ?? undefined,
      createdAt: saved.createdAt.getTime(),
      preferR2: saved.preferR2 ?? undefined,
    };
    this.jobs.set(jobId, job);
    return job;
  }

  private async dispatchJob(jobId: string) {
    if (this.dispatcher) {
      await this.dispatcher(jobId);
      return;
    }
    this.enqueueInline(jobId);
  }

  /** Local in-process queue (no Redis). */
  enqueueInline(jobId: string) {
    if (!this.inlinePump) {
      this.logger.warn(`inline pump disabled but no BullMQ enqueue for job=${jobId}`);
    }
    if (!this.queue.includes(jobId)) this.queue.push(jobId);
    this.pump();
  }

  private pump() {
    if (!this.inlinePump) return;
    if (this.running) return;
    const next = this.queue.shift();
    if (!next) return;
    this.running = true;
    this.processTranscodeJob(next)
      .catch((e) => this.logger.error(e))
      .finally(() => {
        this.running = false;
        this.pump();
      });
  }

  /** Public entry for BullMQ Worker / inline pump. */
  async processTranscodeJob(jobId: string) {
    const job = await this.hydrateJob(jobId);
    if (!job) {
      this.logger.warn(`transcode job missing: ${jobId}`);
      return;
    }
    if (job.status === 'completed' || job.status === 'failed') {
      return;
    }

    job.status = 'processing';
    await this.prisma.mediaTranscodeJob.update({
      where: { id: jobId },
      data: { status: 'PROCESSING', startedAt: new Date(), attempts: { increment: 1 }, error: null },
    });

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
      await this.persistFinishedJob(job);
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
      await this.persistFinishedJob(job);
      if (job.episodeId) {
        await this.prisma.episode
          .update({ where: { id: BigInt(job.episodeId) }, data: { transcodeStatus: 'FAILED' } })
          .catch(() => undefined);
      }
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
      const mediaDimensions = await this.probeMediaDimensions(ffmpeg, playlist);

      let hlsUrl: string = outputRel;
      let pushedToR2 = false;
      const pushR2 =
        job.preferR2 === true
          ? this.r2.hasCredentials()
          : job.preferR2 === false
            ? false
            : this.r2.isEnabled() && this.r2.hasCredentials();
      if (job.preferR2 === true && !this.r2.hasCredentials()) {
        job.status = 'failed';
        job.error = 'R2 credentials not configured';
        await this.persistFinishedJob(job);
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
      if (pushR2) {
        try {
          const prefix = `hls/${job.episodeId || jobId}`;
          hlsUrl = await this.r2.uploadHlsDirectory(outDir, prefix);
          pushedToR2 = true;
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
            // After CDN push, drop local original pointer — source lives on R2 media bucket.
            ...(pushedToR2 ? { originalUrl: null } : {}),
            transcodeStatus: 'COMPLETED',
            uploadStatus: 'COMPLETED',
            ...(durationSec != null ? { durationSec } : {}),
            ...(mediaDimensions || {}),
          },
        });
      }
      this.logger.log(`transcode ok job=${jobId} → ${hlsUrl} duration=${durationSec ?? '?'}`);
      await this.persistFinishedJob(job);

      if (pushedToR2) {
        this.cleanupLocalAfterR2({ inputRel: job.inputRel, outDir });
      }
    } catch (e: any) {
      job.status = 'failed';
      job.error = e?.message || String(e);
      await this.persistFinishedJob(job).catch(() => undefined);
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

  /** After HLS is on velvet-media, remove local staging copies. */
  private cleanupLocalAfterR2(opts: { inputRel?: string; outDir?: string }) {
    if (opts.outDir) {
      try {
        if (fs.existsSync(opts.outDir)) {
          fs.rmSync(opts.outDir, { recursive: true, force: true });
          this.logger.log(`cleaned local hls dir ${opts.outDir}`);
        }
      } catch (e: any) {
        this.logger.warn(`cleanup hls failed: ${e?.message || e}`);
      }
    }
    const rel = opts.inputRel?.replace(/\\/g, '/');
    if (rel && (rel.startsWith('uploads/') || rel.startsWith('uploads\\'))) {
      try {
        const abs = this.resolveAbs(rel);
        if (fs.existsSync(abs) && abs.includes(`${path.sep}uploads${path.sep}`)) {
          fs.unlinkSync(abs);
          this.logger.log(`cleaned local upload ${rel}`);
        }
      } catch (e: any) {
        this.logger.warn(`cleanup upload failed: ${e?.message || e}`);
      }
    }
  }

  private async persistFinishedJob(job: TranscodeJob) {
    await this.prisma.mediaTranscodeJob.update({
      where: { id: job.id },
      data: {
        status: job.status === 'completed' ? 'COMPLETED' : 'FAILED',
        outputRel: job.outputRel || null,
        error: job.error || null,
        finishedAt: new Date(),
      },
    });
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

  private async probeMediaDimensions(
    ffmpegBin: string,
    input: string,
  ): Promise<{
    mediaWidth: number;
    mediaHeight: number;
    mediaOrientation: 'LANDSCAPE' | 'PORTRAIT' | 'SQUARE';
  } | null> {
    try {
      const probe = ffmpegBin.replace(/ffmpeg(?=\.exe$|$)/i, 'ffprobe');
      const { stdout } = await execFileAsync(
        probe,
        [
          '-v',
          'error',
          '-select_streams',
          'v:0',
          '-show_streams',
          '-of',
          'json',
          input,
        ],
        { timeout: 15000 },
      );
      const stream = JSON.parse(String(stdout))?.streams?.[0];
      let width = Number(stream?.width || 0);
      let height = Number(stream?.height || 0);
      if (width <= 0 || height <= 0) return null;
      const sar = String(stream?.sample_aspect_ratio || '').match(/^(\d+):(\d+)$/);
      if (sar && Number(sar[2]) > 0) width = Math.round((width * Number(sar[1])) / Number(sar[2]));
      const rotation = Number(stream?.tags?.rotate ?? stream?.side_data_list?.[0]?.rotation ?? 0);
      if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
      return {
        mediaWidth: width,
        mediaHeight: height,
        mediaOrientation: width === height ? 'SQUARE' : width > height ? 'LANDSCAPE' : 'PORTRAIT',
      };
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

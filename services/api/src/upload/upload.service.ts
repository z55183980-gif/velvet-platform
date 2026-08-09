import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import { signMediaPath } from '../common/media-sign.util';
import { requireSecret } from '../common/security-config';
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
  watermarkEnabled?: boolean;
  /** Top-left X/Y as 0–1 of frame; scale = watermark width / frame width. */
  watermarkX?: number;
  watermarkY?: number;
  watermarkScale?: number;
}

export type TranscodeEnqueueOpts = {
  preferR2?: boolean;
  watermarkEnabled?: boolean;
  watermarkX?: number;
  watermarkY?: number;
  watermarkScale?: number;
};

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

  /** Hourly: purge unreferenced uploads + stale multipart staging (disk DoS mitigation). */
  @Cron(CronExpression.EVERY_HOUR)
  async cronCleanupOrphanUploads() {
    try {
      await this.cleanupOrphanUploads();
    } catch (e: any) {
      this.logger.warn(`orphan upload GC failed: ${e?.message || e}`);
    }
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

  /** Per-user durable upload quota (bytes). Env override: UPLOAD_USER_QUOTA_BYTES. */
  userUploadQuotaBytes(): number {
    const n = Number(process.env.UPLOAD_USER_QUOTA_BYTES || 2 * 1024 * 1024 * 1024);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2 * 1024 * 1024 * 1024;
  }

  /** Orphan uploads older than this are deleted (hours). */
  orphanUploadTtlHours(): number {
    const n = Number(process.env.UPLOAD_ORPHAN_TTL_HOURS || 24);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 24;
  }

  /** Sum bytes under uploads/ owned by user prefix `{userId}-` or referenced by their episodes. */
  assertWithinUserQuota(userId: bigint, incomingBytes: number) {
    const quota = this.userUploadQuotaBytes();
    const dir = this.getUploadDir();
    const prefix = `${userId.toString()}-`;
    let used = 0;
    try {
      for (const name of fs.readdirSync(dir)) {
        if (!name.startsWith(prefix)) continue;
        try {
          used += fs.statSync(path.join(dir, name)).size;
        } catch {
          /* ignore */
        }
      }
    } catch {
      used = 0;
    }
    if (used + Math.max(0, incomingBytes) > quota) {
      throw new BizException(BizCode.FORBIDDEN, 'upload.quotaExceeded');
    }
  }

  /**
   * Delete uploads/ files not referenced by any episode and older than TTL.
   * Also purges stale .multipart staging files (always safe — never final media).
   */
  async cleanupOrphanUploads(opts?: {
    ttlHours?: number;
  }): Promise<{ removed: number; freedBytes: number }> {
    const ttlMs = (opts?.ttlHours ?? this.orphanUploadTtlHours()) * 3600_000;
    const cutoff = Date.now() - ttlMs;
    let removed = 0;
    let freedBytes = 0;

    const referenced = new Set<string>();
    const rows = await this.prisma.episode.findMany({
      select: { originalUrl: true, hlsUrl: true },
      take: 50_000,
    });
    for (const r of rows) {
      for (const u of [r.originalUrl, r.hlsUrl]) {
        if (!u) continue;
        const norm = u.replace(/\\/g, '/');
        if (norm.startsWith('uploads/')) referenced.add(path.basename(norm));
      }
    }

    const dir = this.getUploadDir();
    try {
      for (const name of fs.readdirSync(dir)) {
        if (referenced.has(name)) continue;
        const abs = path.join(dir, name);
        let st: fs.Stats;
        try {
          st = fs.statSync(abs);
        } catch {
          continue;
        }
        if (!st.isFile() || st.mtimeMs > cutoff) continue;
        try {
          fs.rmSync(abs, { force: true });
          removed += 1;
          freedBytes += st.size;
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }

    const staging = path.join(this.getStorageRoot(), '.multipart');
    try {
      for (const name of fs.readdirSync(staging)) {
        const abs = path.join(staging, name);
        let st: fs.Stats;
        try {
          st = fs.statSync(abs);
        } catch {
          continue;
        }
        if (!st.isFile() || st.mtimeMs > cutoff) continue;
        try {
          fs.rmSync(abs, { force: true });
          removed += 1;
          freedBytes += st.size;
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }

    if (removed > 0) {
      this.logger.warn(
        `orphan upload GC removed ${removed} file(s), freed ~${freedBytes} bytes`,
      );
    }
    return { removed, freedBytes };
  }

  saveUpload(file: Express.Multer.File, opts?: { userId?: bigint }): UploadResult {
    if (!file) throw new BizException(BizCode.BAD_REQUEST, '未收到文件');
    const ext = path.extname(file.originalname || '').toLowerCase() || '.mp4';
    if (!VIDEO_EXT.has(ext)) {
      throw new BizException(BizCode.BAD_REQUEST, `不支持的格式: ${ext}`);
    }
    if (opts?.userId != null) {
      this.assertWithinUserQuota(opts.userId, file.size || 0);
    }
    const rawMime = file.mimetype || '';
    const mime =
      !rawMime || rawMime === 'application/octet-stream'
        ? VIDEO_MIME_BY_EXT[ext] || 'video/mp4'
        : rawMime;
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const owner = opts?.userId != null ? `${opts.userId.toString()}-` : '';
    const filename = `${owner}${Date.now()}-${id}${ext}`;
    const abs = path.join(this.getUploadDir(), filename);
    if (file.path) {
      const staged = path.resolve(file.path);
      const stagingRoot = path.resolve(this.getStorageRoot(), '.multipart');
      if (staged !== stagingRoot && !staged.startsWith(stagingRoot + path.sep)) {
        throw new BizException(BizCode.FORBIDDEN, 'invalid multipart staging path');
      }
      fs.renameSync(staged, abs);
    } else if (file.buffer) {
      // Small/internal callers may still provide an in-memory Multer file.
      fs.writeFileSync(abs, file.buffer);
    } else {
      throw new BizException(BizCode.BAD_REQUEST, '上传文件内容为空');
    }
    const relativePath = `uploads/${filename}`;
    return {
      relativePath,
      originalUrl: relativePath,
      filename,
      size: file.size,
      mime,
    };
  }

  /** KYC 文档类上传（jpg/png/webp，5MB 限制）；返回带签名的 media URL */
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
    const key = requireSecret(
      'CDN_SIGN_KEY',
      this.config.get<string>('CDN_SIGN_KEY'),
      'dev',
    );
    const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
    const sig = signMediaPath(relativePath, exp, key);
    const mediaUrl = `/api/v1/media/${relativePath
      .split('/')
      .map(encodeURIComponent)
      .join('/')}?sig=${sig}&exp=${exp}`;
    return {
      relativePath,
      originalUrl: mediaUrl,
      filename,
      size: file.size,
      mime: file.mimetype || mimeByExt[ext] || 'image/jpeg',
    };
  }

  /** 封面/缩略图上传 → STORAGE_ROOT/covers；R2 开启时同步推送到 velvet-media */
  async saveImage(
    file: Express.Multer.File,
    kind: 'cover' | 'thumbnail' | 'image' | 'avatar' = 'cover',
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

  /**
   * Remove local files + R2 objects for media URLs.
   * Callers should clear / delete DB refs first, then purge with allowOrphans=true
   * so a storage failure cannot leave hanging refs. When allowOrphans is false
   * (rare pre-check paths), R2 failures still hard-fail.
   */
  async purgeMediaUrls(
    urls: Array<string | null | undefined>,
    opts?: { requireR2?: boolean; allowOrphans?: boolean },
  ): Promise<{
    r2Deleted: number;
    localDeleted: number;
    error?: string;
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

    const remoteR2 = urls.some((u) => {
      const raw = u?.trim();
      if (!raw || !/^https?:\/\//i.test(raw)) return false;
      return !!this.r2.mediaPrefixFromUrl(raw);
    });
    const requireR2 = !!opts?.requireR2 || remoteR2;
    const allowOrphans = !!opts?.allowOrphans;

    if (!this.r2.hasCredentials()) {
      if (requireR2) {
        const msg =
          '媒资清理失败：需要删除 R2/CDN 对象但服务端未配置 R2 凭证';
        if (allowOrphans) {
          this.logger.error(`${msg} (DB already updated; orphan objects may remain)`);
          return { r2Deleted: 0, localDeleted, error: msg };
        }
        throw new BizException(
          BizCode.CONFLICT,
          `${msg}，已中止删除（数据库未改动）`,
        );
      }
      return { r2Deleted: 0, localDeleted };
    }

    try {
      const r2Deleted = await this.r2.purgeUrls(urls);
      return { r2Deleted, localDeleted };
    } catch (e: any) {
      const msg = e?.message || String(e);
      this.logger.error(`R2 purge failed: ${msg}`);
      if (allowOrphans) {
        return {
          r2Deleted: 0,
          localDeleted,
          error: `R2 purge failed: ${msg}`,
        };
      }
      throw new BizException(
        BizCode.CONFLICT,
        `媒资清理失败（R2）：${msg}。已中止删除（数据库未改动）`,
      );
    }
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
    const storageRoot = path.resolve(this.getStorageRoot());
    const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const inStorage = path.resolve(path.join(storageRoot, normalized));
    if (inStorage !== storageRoot && !inStorage.startsWith(storageRoot + path.sep)) {
      throw new BizException(BizCode.FORBIDDEN, 'invalid path');
    }
    if (fs.existsSync(inStorage)) return inStorage;
    const mediaRootRaw = this.config.get<string>('MEDIA_ROOT');
    if (mediaRootRaw) {
      const mediaRoot = path.resolve(mediaRootRaw);
      const inMedia = path.resolve(path.join(mediaRoot, normalized));
      if (inMedia !== mediaRoot && !inMedia.startsWith(mediaRoot + path.sep)) {
        throw new BizException(BizCode.FORBIDDEN, 'invalid path');
      }
      if (fs.existsSync(inMedia)) return inMedia;
    }
    return inStorage;
  }

  async enqueueTranscode(
    inputRel: string,
    episodeId?: string,
    opts?: TranscodeEnqueueOpts,
  ): Promise<TranscodeJob> {
    const id = crypto.randomUUID();
    const watermarkEnabled = !!opts?.watermarkEnabled;
    const watermarkX =
      watermarkEnabled && opts?.watermarkX != null && Number.isFinite(opts.watermarkX)
        ? Math.min(1, Math.max(0, opts.watermarkX))
        : watermarkEnabled
          ? 0.84
          : undefined;
    const watermarkY =
      watermarkEnabled && opts?.watermarkY != null && Number.isFinite(opts.watermarkY)
        ? Math.min(1, Math.max(0, opts.watermarkY))
        : watermarkEnabled
          ? 0.84
          : undefined;
    const watermarkScale =
      watermarkEnabled && opts?.watermarkScale != null && Number.isFinite(opts.watermarkScale)
        ? Math.min(0.4, Math.max(0.04, opts.watermarkScale))
        : watermarkEnabled
          ? 0.12
          : undefined;
    const job: TranscodeJob = {
      id,
      episodeId,
      inputRel,
      status: 'queued',
      createdAt: Date.now(),
      preferR2: opts?.preferR2,
      watermarkEnabled: watermarkEnabled || undefined,
      watermarkX,
      watermarkY,
      watermarkScale,
    };
    await this.prisma.mediaTranscodeJob.create({
      data: {
        id,
        episodeId: episodeId ? BigInt(episodeId) : null,
        inputRel,
        status: 'QUEUED',
        preferR2: opts?.preferR2,
        watermarkEnabled: watermarkEnabled || null,
        watermarkX: watermarkX ?? null,
        watermarkY: watermarkY ?? null,
        watermarkScale: watermarkScale ?? null,
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
      watermarkEnabled: saved.watermarkEnabled ?? undefined,
      watermarkX: saved.watermarkX ?? undefined,
      watermarkY: saved.watermarkY ?? undefined,
      watermarkScale: saved.watermarkScale ?? undefined,
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
      watermarkEnabled: saved.watermarkEnabled ?? undefined,
      watermarkX: saved.watermarkX ?? undefined,
      watermarkY: saved.watermarkY ?? undefined,
      watermarkScale: saved.watermarkScale ?? undefined,
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
      await this.execFfmpeg(ffmpeg, inputAbs, playlist, {
        watermarkEnabled: !!job.watermarkEnabled,
        watermarkX: job.watermarkX,
        watermarkY: job.watermarkY,
        watermarkScale: job.watermarkScale,
      });
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
            // Hosted output is authoritative; pin expiry so yt-dlp URL refresh never clobbers it.
            resolvedExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
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

  /** Absolute path to Velvet watermark PNG (API host). */
  watermarkAssetPath(): string | null {
    const configured = this.config.get<string>('WATERMARK_PATH')?.trim();
    const candidates = [
      configured,
      path.join(process.cwd(), 'assets', 'velvet-watermark.png'),
      path.join(__dirname, '..', '..', 'assets', 'velvet-watermark.png'),
    ].filter(Boolean) as string[];
    for (const p of candidates) {
      const abs = path.resolve(p);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
    }
    return null;
  }

  /**
   * Extract first video frame as JPEG under STORAGE_ROOT/tmp/frames for watermark placement UI.
   */
  async extractFirstFrame(inputRelOrAbs: string): Promise<{
    relativePath: string;
    url: string;
    width: number;
    height: number;
  }> {
    const ffmpeg = await this.detectFfmpeg();
    if (!ffmpeg) {
      throw new BizException(BizCode.BAD_REQUEST, '未检测到 ffmpeg，无法抽取首帧');
    }
    const raw = String(inputRelOrAbs || '').trim();
    const isRemote = /^https?:\/\//i.test(raw);
    const inputAbs = isRemote
      ? raw
      : path.isAbsolute(raw)
        ? raw
        : this.resolveAbs(raw);
    if (!isRemote && !fs.existsSync(inputAbs)) {
      throw new BizException(BizCode.BAD_REQUEST, '源视频不存在');
    }
    const outDir = path.join(this.getStorageRoot(), 'tmp', 'frames');
    fs.mkdirSync(outDir, { recursive: true });
    const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jpg`;
    const outAbs = path.join(outDir, filename);
    await execFileAsync(
      ffmpeg,
      [
        '-y',
        '-ss',
        '0.4',
        '-i',
        inputAbs,
        '-frames:v',
        '1',
        '-q:v',
        '2',
        outAbs,
      ],
      { timeout: 90_000, maxBuffer: 2 * 1024 * 1024 },
    );
    if (!fs.existsSync(outAbs)) {
      throw new BizException(BizCode.BAD_REQUEST, '首帧抽取失败');
    }
    const dims = await this.probeMediaDimensions(ffmpeg, outAbs);
    const relativePath = `tmp/frames/${filename}`;
    const key = requireSecret(
      'CDN_SIGN_KEY',
      this.config.get<string>('CDN_SIGN_KEY'),
      'dev',
    );
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const sig = signMediaPath(relativePath, exp, key);
    const url = `/api/v1/media/${relativePath
      .split('/')
      .map(encodeURIComponent)
      .join('/')}?sig=${sig}&exp=${exp}`;
    return {
      relativePath,
      url,
      width: dims?.mediaWidth || 0,
      height: dims?.mediaHeight || 0,
    };
  }

  private execFfmpeg(
    bin: string,
    input: string,
    playlist: string,
    watermark?: {
      watermarkEnabled?: boolean;
      watermarkX?: number;
      watermarkY?: number;
      watermarkScale?: number;
    },
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const wmPath = watermark?.watermarkEnabled ? this.watermarkAssetPath() : null;
      const useWm = !!wmPath;
      if (watermark?.watermarkEnabled && !wmPath) {
        reject(new Error('watermark asset missing (WATERMARK_PATH / assets/velvet-watermark.png)'));
        return;
      }
      const scale = watermark?.watermarkScale ?? 0.12;
      const wx = watermark?.watermarkX ?? 0.84;
      const wy = watermark?.watermarkY ?? 0.84;

      // scale2ref: watermark width = video_width * scale; keep aspect.
      const args = useWm
        ? [
            '-y',
            '-i',
            input,
            '-i',
            wmPath!,
            '-filter_complex',
            `[1:v][0:v]scale2ref=w=iw*${scale}:h=ow/mdar[wm][base];[base][wm]overlay=x='main_w*${wx}':y='main_h*${wy}'`,
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
          ]
        : [
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

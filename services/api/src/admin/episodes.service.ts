import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import { AuditService } from '../common/audit.service';
import { LockAccessService } from '../common/lock-access.service';
import { UploadService } from '../upload/upload.service';
import { convertExternalPlayUrl } from './online-drama.util';

function toBigIntCredits(v: number | string | undefined | null, fallback = 0n): bigint {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) {
    throw new BizException(BizCode.BAD_REQUEST, '积分/价格必须为 >= 0 的数字');
  }
  return BigInt(Math.floor(n));
}

@Injectable()
export class AdminEpisodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly upload: UploadService,
    private readonly lockAccess: LockAccessService,
  ) {}

  async listByDrama(dramaId: string) {
    return this.prisma.episode.findMany({
      where: { dramaId: BigInt(dramaId) },
      orderBy: { episodeNumber: 'asc' },
    });
  }

  async create(
    dramaId: string,
    dto: {
      title?: string;
      episodeNumber?: number;
      isFree?: boolean;
      previewSeconds?: number;
      priceCredits?: number | string;
      priceVnd?: number | string;
      thumbnailUrl?: string;
      sourceUrl?: string;
      hlsUrl?: string;
      originalUrl?: string;
    },
    actorId?: bigint,
  ) {
    const drama = await this.prisma.drama.findUnique({ where: { id: BigInt(dramaId) } });
    if (!drama) throw new BizException(BizCode.NOT_FOUND, 'drama.notFound');

    let episodeNumber = dto.episodeNumber != null ? Math.floor(Number(dto.episodeNumber)) : NaN;
    if (!Number.isFinite(episodeNumber) || episodeNumber < 1) {
      const max = await this.prisma.episode.aggregate({
        where: { dramaId: drama.id },
        _max: { episodeNumber: true },
      });
      episodeNumber = (max._max.episodeNumber ?? 0) + 1;
    }

    const occupied = await this.prisma.episode.findUnique({
      where: { dramaId_episodeNumber: { dramaId: drama.id, episodeNumber } },
    });
    if (occupied) {
      throw new BizException(BizCode.CONFLICT, `第 ${episodeNumber} 集已存在`);
    }

    // Default isFree from resolved lock policy (inherit/ALL_FREE/first-N) when omitted —
    // never leave new episodes paid under ALL_FREE / global inherit by accident.
    const policy = await this.lockAccess.resolveForDrama(drama);
    const isFree =
      dto.isFree != null
        ? !!dto.isFree
        : this.lockAccess.isFree({ isFree: false, episodeNumber }, policy);
    const previewSeconds = isFree ? 0 : Math.max(0, Math.floor(Number(dto.previewSeconds) || 0));
    const priceCredits = isFree ? 0n : toBigIntCredits(dto.priceCredits, 0n);
    const priceVnd = isFree ? 0n : toBigIntCredits(dto.priceVnd ?? dto.priceCredits, 0n);
    // 实际扣款只认 priceCredits（priceVnd 是遗留展示字段），必须单独校验，
    // 否则只填 priceVnd 就能让付费集通过校验但按 0 积分解锁。
    if (!isFree && priceCredits <= 0n) {
      throw new BizException(BizCode.BAD_REQUEST, '付费集需设置积分价 > 0');
    }

    const hasMediaInput = !!(dto.sourceUrl?.trim() || dto.hlsUrl?.trim() || dto.originalUrl?.trim());
    if (drama.sourceType === 'ONLINE' && hasMediaInput) {
      this.assertOnlineHttpMedia(dto.sourceUrl || dto.hlsUrl || dto.originalUrl || '');
    }
    const urls = hasMediaInput
      ? this.resolveMediaUrls(dto)
      : { hlsUrl: null as string | null, originalUrl: null as string | null };
    const ep = await this.prisma.$transaction(async (tx) => {
      const created = await tx.episode.create({
        data: {
          dramaId: drama.id,
          episodeNumber,
          title: dto.title?.trim() || `第${episodeNumber}集`,
          isFree,
          previewSeconds,
          priceCredits,
          priceVnd,
          thumbnailUrl: dto.thumbnailUrl?.trim() || null,
          hlsUrl: urls.hlsUrl,
          originalUrl: urls.originalUrl,
          uploadStatus: urls.hlsUrl || urls.originalUrl ? 'COMPLETED' : 'PENDING',
          transcodeStatus: /^https?:\/\//i.test(urls.hlsUrl || '') || urls.hlsUrl?.endsWith('.m3u8')
            ? 'COMPLETED'
            : urls.originalUrl || urls.hlsUrl
              ? 'PENDING'
              : 'PENDING',
        },
      });
      // Preserve announced/planned total when it is already ahead of inventory.
      const count = await tx.episode.count({ where: { dramaId: drama.id } });
      await tx.drama.update({
        where: { id: drama.id },
        data: { totalEpisodes: Math.max(drama.totalEpisodes ?? 0, count) },
      });
      return created;
    });

    await this.audit.write({
      actorId,
      action: 'episode.create',
      targetType: 'episode',
      targetId: ep.id.toString(),
      payload: { dramaId, episodeNumber: ep.episodeNumber },
    });
    return this.serialize(ep);
  }

  async update(
    id: string,
    dto: {
      title?: string;
      isFree?: boolean;
      previewSeconds?: number;
      priceCredits?: number | string;
      priceVnd?: number | string;
      thumbnailUrl?: string;
      sourceUrl?: string;
      hlsUrl?: string;
      originalUrl?: string;
      transcodeStatus?: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    },
    actorId?: bigint,
  ) {
    const ep = await this.prisma.episode.findUnique({
      where: { id: BigInt(id) },
      include: { drama: { select: { sourceType: true } } },
    });
    if (!ep) throw new BizException(BizCode.NOT_FOUND, 'episode.notFound');
    const data: Record<string, unknown> = {};
    if (dto.title != null) data.title = dto.title;
    if (dto.isFree != null) {
      data.isFree = !!dto.isFree;
      if (data.isFree) {
        data.previewSeconds = 0;
        data.priceCredits = 0n;
        data.priceVnd = 0n;
      }
    }
    if (dto.previewSeconds != null && !data.isFree) {
      data.previewSeconds = Math.max(0, Math.floor(Number(dto.previewSeconds) || 0));
    }
    if (dto.priceCredits != null) data.priceCredits = toBigIntCredits(dto.priceCredits);
    if (dto.priceVnd != null) data.priceVnd = toBigIntCredits(dto.priceVnd);
    if (dto.thumbnailUrl != null) data.thumbnailUrl = dto.thumbnailUrl;
    if (dto.transcodeStatus != null) data.transcodeStatus = dto.transcodeStatus;

    if (dto.sourceUrl != null || dto.hlsUrl != null || dto.originalUrl != null) {
      if (ep.drama.sourceType === 'ONLINE') {
        this.assertOnlineHttpMedia(dto.sourceUrl || dto.hlsUrl || dto.originalUrl || '');
      }
      const urls = this.resolveMediaUrls({
        sourceUrl: dto.sourceUrl,
        hlsUrl: dto.hlsUrl ?? ep.hlsUrl ?? undefined,
        originalUrl: dto.originalUrl ?? ep.originalUrl ?? undefined,
      });
      data.hlsUrl = urls.hlsUrl;
      data.originalUrl = urls.originalUrl;
      data.mediaWidth = null;
      data.mediaHeight = null;
      data.mediaOrientation = null;
      if (urls.hlsUrl || urls.originalUrl) {
        data.uploadStatus = 'COMPLETED';
        if (urls.hlsUrl?.endsWith('.m3u8') || /^https?:\/\//i.test(urls.hlsUrl || '')) {
          data.transcodeStatus = 'COMPLETED';
        } else if (dto.transcodeStatus == null) {
          data.transcodeStatus = 'PENDING';
        }
      }
    }

    if (Object.keys(data).length === 0) {
      throw new BizException(BizCode.BAD_REQUEST, 'common.noFieldsToUpdate');
    }
    const effectiveFree = data.isFree != null ? Boolean(data.isFree) : ep.isFree;
    const effectiveCredits = typeof data.priceCredits === 'bigint' ? data.priceCredits : ep.priceCredits;
    // 实际扣款只认 priceCredits（priceVnd 是遗留展示字段），必须单独校验，
    // 否则只填 priceVnd 就能让付费集通过校验但按 0 积分解锁。
    if (!effectiveFree && effectiveCredits <= 0n) {
      throw new BizException(BizCode.BAD_REQUEST, '付费集需设置积分价 > 0');
    }
    const updated = await this.prisma.episode.update({
      where: { id: BigInt(id) },
      data,
    });
    await this.audit.write({
      actorId,
      action: 'episode.update',
      targetType: 'episode',
      targetId: id,
      payload: data,
    });
    return { id: updated.id.toString(), data: this.serialize(updated) };
  }

  async delete(id: string, actorId?: bigint) {
    const ep = await this.prisma.episode.findUnique({
      where: { id: BigInt(id) },
      include: { drama: { select: { sourceType: true } } },
    });
    if (!ep) throw new BizException(BizCode.NOT_FOUND, 'episode.notFound');

    const purge = await this.upload.purgeMediaUrls(
      [ep.hlsUrl, ep.originalUrl, ep.thumbnailUrl],
      { requireR2: ep.drama.sourceType === 'R2' },
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.episode.delete({ where: { id: ep.id } });
      const remaining = await tx.episode.findMany({
        where: { dramaId: ep.dramaId },
        orderBy: { episodeNumber: 'asc' },
        select: { id: true },
      });
      for (let i = 0; i < remaining.length; i++) {
        await tx.episode.update({
          where: { id: remaining[i].id },
          data: { episodeNumber: i + 1 },
        });
      }
      const drama = await tx.drama.findUnique({
        where: { id: ep.dramaId },
        select: { totalEpisodes: true },
      });
      const prev = drama?.totalEpisodes ?? remaining.length;
      // If prev was only tracking inventory (prev == count before delete), shrink with deletes.
      // If prev was an announced future total (prev > count+1), keep it for placeholders.
      await tx.drama.update({
        where: { id: ep.dramaId },
        data: { totalEpisodes: prev > remaining.length + 1 ? prev : remaining.length },
      });
    });

    await this.audit.write({
      actorId,
      action: 'episode.delete',
      targetType: 'episode',
      targetId: id,
      payload: {
        dramaId: ep.dramaId.toString(),
        episodeNumber: ep.episodeNumber,
        purge,
      },
    });
    return { ok: true, purge };
  }

  async purgeMedia(id: string, actorId?: bigint) {
    const ep = await this.prisma.episode.findUnique({ where: { id: BigInt(id) } });
    if (!ep) throw new BizException(BizCode.NOT_FOUND, 'episode.notFound');
    const purge = await this.upload.purgeMediaUrls([
      ep.hlsUrl,
      ep.originalUrl,
      ep.thumbnailUrl,
    ]);
    await this.prisma.episode.update({
      where: { id: ep.id },
      data: {
        hlsUrl: null,
        originalUrl: null,
        mediaWidth: null,
        mediaHeight: null,
        mediaOrientation: null,
        uploadStatus: 'PENDING',
        transcodeStatus: 'PENDING',
      },
    });
    await this.audit.write({
      actorId,
      action: 'episode.media.purge',
      targetType: 'episode',
      targetId: id,
      payload: purge,
    });
    return { ok: true, purge };
  }

  async uploadVideo(
    id: string,
    file: Express.Multer.File,
    actorId?: bigint,
    opts?: {
      preferR2?: boolean;
      watermarkEnabled?: boolean;
      watermarkX?: number;
      watermarkY?: number;
      watermarkScale?: number;
    },
  ) {
    const ep = await this.prisma.episode.findUnique({
      where: { id: BigInt(id) },
      include: { drama: { select: { sourceType: true } } },
    });
    if (!ep) throw new BizException(BizCode.NOT_FOUND, 'episode.notFound');
    this.assertHostedUploadAllowed(ep.drama.sourceType);
    if (!file) throw new BizException(BizCode.BAD_REQUEST, '未收到文件');

    await this.upload.purgeMediaUrls([ep.hlsUrl, ep.originalUrl]).catch(() => undefined);

    const saved = this.upload.saveUpload(file);
    await this.prisma.episode.update({
      where: { id: ep.id },
      data: {
        originalUrl: saved.relativePath,
        hlsUrl: saved.relativePath,
        mediaWidth: null,
        mediaHeight: null,
        mediaOrientation: null,
        uploadStatus: 'COMPLETED',
        transcodeStatus: 'PENDING',
      },
    });
    const job = await this.upload.enqueueTranscode(saved.relativePath, String(ep.id), opts);
    await this.audit.write({
      actorId,
      action: 'episode.upload',
      targetType: 'episode',
      targetId: id,
      payload: {
        relativePath: saved.relativePath,
        jobId: job.id,
        size: saved.size,
        watermarkEnabled: !!opts?.watermarkEnabled,
      },
    });
    return {
      episode: this.serialize({
        ...ep,
        originalUrl: saved.relativePath,
        hlsUrl: saved.relativePath,
        uploadStatus: 'COMPLETED',
        transcodeStatus: 'PENDING',
      }),
      ...saved,
      jobId: job.id,
      transcodeStatus: job.status,
      storage: this.upload.storageStatus(),
      ffmpegReady: !!(await this.upload.detectFfmpeg()),
    };
  }

  async createWithUpload(
    dramaId: string,
    file: Express.Multer.File,
    dto: {
      title?: string;
      episodeNumber?: number;
      isFree?: boolean;
      previewSeconds?: number;
      priceCredits?: number | string;
      thumbnailUrl?: string;
      watermarkEnabled?: boolean;
      watermarkX?: number;
      watermarkY?: number;
      watermarkScale?: number;
    },
    actorId?: bigint,
  ) {
    if (!file) throw new BizException(BizCode.BAD_REQUEST, '未收到文件');
    const drama = await this.prisma.drama.findUnique({
      where: { id: BigInt(dramaId) },
      select: { sourceType: true },
    });
    if (!drama) throw new BizException(BizCode.NOT_FOUND, 'drama.notFound');
    this.assertHostedUploadAllowed(drama.sourceType);
    const created = await this.create(
      dramaId,
      {
        title: dto.title,
        episodeNumber: dto.episodeNumber,
        isFree: dto.isFree,
        previewSeconds: dto.previewSeconds,
        priceCredits: dto.isFree === true ? 0 : dto.priceCredits ?? 10,
        thumbnailUrl: dto.thumbnailUrl,
      },
      actorId,
    );
    return this.uploadVideo(created.id, file, actorId, {
      watermarkEnabled: dto.watermarkEnabled,
      watermarkX: dto.watermarkX,
      watermarkY: dto.watermarkY,
      watermarkScale: dto.watermarkScale,
    });
  }

  /**
   * Browser PUT → R2 (velvet-uploads) → confirm: API pulls object to local uploads/ and enqueues transcode.
   */
  async createWithR2DirectUpload(
    dramaId: string,
    dto: {
      key: string;
      filename?: string;
      title?: string;
      episodeNumber?: number;
      isFree?: boolean;
      previewSeconds?: number;
      priceCredits?: number | string;
      thumbnailUrl?: string;
      watermarkEnabled?: boolean;
      watermarkX?: number;
      watermarkY?: number;
      watermarkScale?: number;
    },
    actorId?: bigint,
  ) {
    const key = String(dto.key || '').trim();
    if (!key) throw new BizException(BizCode.BAD_REQUEST, '缺少 R2 object key');

    const drama = await this.prisma.drama.findUnique({
      where: { id: BigInt(dramaId) },
      select: { sourceType: true },
    });
    if (!drama) throw new BizException(BizCode.NOT_FOUND, 'drama.notFound');
    this.assertHostedUploadAllowed(drama.sourceType);

    const created = await this.create(
      dramaId,
      {
        title: dto.title,
        episodeNumber: dto.episodeNumber,
        isFree: dto.isFree,
        previewSeconds: dto.previewSeconds,
        priceCredits: dto.isFree === true ? 0 : dto.priceCredits ?? 10,
        thumbnailUrl: dto.thumbnailUrl,
      },
      actorId,
    );

    try {
      return await this.attachDirectUpload(created.id, key, dto.filename, actorId, {
        watermarkEnabled: dto.watermarkEnabled,
        watermarkX: dto.watermarkX,
        watermarkY: dto.watermarkY,
        watermarkScale: dto.watermarkScale,
      });
    } catch (e) {
      // Avoid orphan occupied episode numbers on confirm failure
      await this.delete(created.id, actorId).catch(() => undefined);
      throw e;
    }
  }

  async attachDirectUpload(
    episodeId: string,
    key: string,
    originalFilename?: string,
    actorId?: bigint,
    opts?: {
      preferR2?: boolean;
      watermarkEnabled?: boolean;
      watermarkX?: number;
      watermarkY?: number;
      watermarkScale?: number;
    },
  ) {
    const ep = await this.prisma.episode.findUnique({
      where: { id: BigInt(episodeId) },
      include: { drama: { select: { sourceType: true } } },
    });
    if (!ep) throw new BizException(BizCode.NOT_FOUND, 'episode.notFound');
    this.assertHostedUploadAllowed(ep.drama.sourceType);

    await this.upload.purgeMediaUrls([ep.hlsUrl, ep.originalUrl]).catch(() => undefined);
    const saved = await this.upload.ingestDirectUploadKey(key, originalFilename);
    await this.prisma.episode.update({
      where: { id: ep.id },
      data: {
        originalUrl: saved.relativePath,
        hlsUrl: saved.relativePath,
        mediaWidth: null,
        mediaHeight: null,
        mediaOrientation: null,
        uploadStatus: 'COMPLETED',
        transcodeStatus: 'PENDING',
      },
    });
    const job = await this.upload.enqueueTranscode(saved.relativePath, String(ep.id), opts);
    await this.audit.write({
      actorId,
      action: 'episode.upload.r2Direct',
      targetType: 'episode',
      targetId: episodeId,
      payload: {
        key,
        relativePath: saved.relativePath,
        jobId: job.id,
        size: saved.size,
        watermarkEnabled: !!opts?.watermarkEnabled,
      },
    });
    return {
      episode: this.serialize({
        ...ep,
        originalUrl: saved.relativePath,
        hlsUrl: saved.relativePath,
        uploadStatus: 'COMPLETED',
        transcodeStatus: 'PENDING',
      }),
      ...saved,
      jobId: job.id,
      transcodeStatus: job.status,
      storage: this.upload.storageStatus(),
      ffmpegReady: !!(await this.upload.detectFfmpeg()),
      directUpload: true,
    };
  }

  async listStorage(
    dramaId: string,
    opts?: { page?: number; pageSize?: number; includeTotals?: boolean },
  ) {
    const where = { dramaId: BigInt(dramaId) };
    const pageSize = Math.min(100, Math.max(1, Math.floor(opts?.pageSize ?? 10)));
    const total = await this.prisma.episode.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
    const page = Math.min(totalPages, Math.max(1, Math.floor(opts?.page ?? 1)));
    const includeTotals = opts?.includeTotals === true;

    const episodes = await this.prisma.episode.findMany({
      where,
      orderBy: { episodeNumber: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        episodeNumber: true,
        title: true,
        hlsUrl: true,
        originalUrl: true,
        thumbnailUrl: true,
        transcodeStatus: true,
        uploadStatus: true,
      },
    });

    const items: Array<{
      id: string;
      episodeNumber: number;
      title: string | null;
      hlsUrl: string | null;
      originalUrl: string | null;
      thumbnailUrl: string | null;
      transcodeStatus: string;
      uploadStatus: string;
      r2Prefix: string | null;
      objectCount: number;
      totalBytes: number;
      objects: Array<{ key: string; size: number; lastModified?: string }>;
    }> = [];
    for (const ep of episodes) {
      const listed = await this.upload.listEpisodeR2Objects(ep.hlsUrl);
      items.push({
        id: ep.id.toString(),
        episodeNumber: ep.episodeNumber,
        title: ep.title,
        hlsUrl: ep.hlsUrl,
        originalUrl: ep.originalUrl,
        thumbnailUrl: ep.thumbnailUrl,
        transcodeStatus: ep.transcodeStatus,
        uploadStatus: ep.uploadStatus,
        r2Prefix: listed.prefix,
        objectCount: listed.objects.length,
        totalBytes: listed.objects.reduce((s, o) => s + o.size, 0),
        objects: listed.objects.slice(0, 50),
      });
    }

    let totals: { objectCount: number; totalBytes: number } | undefined;
    if (includeTotals) {
      // No drama-level R2 prefix (keys are hls/{episodeId}); sum every episode prefix once.
      const allUrls = await this.prisma.episode.findMany({
        where,
        select: { hlsUrl: true },
      });
      let objectCount = 0;
      let totalBytes = 0;
      for (const row of allUrls) {
        const listed = await this.upload.listEpisodeR2Objects(row.hlsUrl);
        objectCount += listed.objects.length;
        totalBytes += listed.objects.reduce((s, o) => s + o.size, 0);
      }
      totals = { objectCount, totalBytes };
    }

    return {
      ...this.upload.storageStatus(),
      ffmpegReady: !!(await this.upload.detectFfmpeg()),
      total,
      page,
      pageSize,
      totals,
      episodes: items,
    };
  }

  async batchUpdate(
    dramaId: string,
    dto: {
      ids: (string | number)[];
      isFree?: boolean;
      priceCredits?: number | string;
    },
    actorId?: bigint,
  ) {
    const ids = (dto.ids || []).map(String).filter(Boolean);
    if (!ids.length) throw new BizException(BizCode.BAD_REQUEST, 'ids 不能为空');
    if (dto.isFree == null && dto.priceCredits == null) {
      throw new BizException(BizCode.BAD_REQUEST, '请指定 isFree 或 priceCredits');
    }
    if (dto.isFree === false && toBigIntCredits(dto.priceCredits, 0n) <= 0n) {
      throw new BizException(BizCode.BAD_REQUEST, '批量设为付费时必须同时设置积分价 > 0');
    }

    const episodes = await this.prisma.episode.findMany({
      where: { dramaId: BigInt(dramaId), id: { in: ids.map((id) => BigInt(id)) } },
      select: { id: true },
    });
    if (episodes.length !== ids.length) {
      throw new BizException(BizCode.BAD_REQUEST, '部分分集不属于该短剧');
    }

    const data: { isFree?: boolean; priceCredits?: bigint; priceVnd?: bigint } = {};
    if (dto.isFree != null) {
      data.isFree = !!dto.isFree;
      if (data.isFree) {
        data.priceCredits = 0n;
        data.priceVnd = 0n;
      }
    }
    if (dto.priceCredits != null && !data.isFree) {
      data.priceCredits = toBigIntCredits(dto.priceCredits);
      data.priceVnd = data.priceCredits;
    }

    await this.prisma.episode.updateMany({
      where: { id: { in: episodes.map((e) => e.id) } },
      data,
    });

    await this.audit.write({
      actorId,
      action: 'episode.batchUpdate',
      targetType: 'drama',
      targetId: dramaId,
      payload: {
        ids,
        isFree: dto.isFree,
        priceCredits: dto.priceCredits,
      },
    });
    return { ok: true, count: episodes.length };
  }

  async reorder(dramaId: string, ids: string[], actorId?: bigint) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BizException(BizCode.BAD_REQUEST, 'ids 不能为空');
    }
    const episodes = await this.prisma.episode.findMany({
      where: { dramaId: BigInt(dramaId) },
      select: { id: true, episodeNumber: true },
    });
    const validIds = new Set(episodes.map((e) => e.id.toString()));
    for (const id of ids) {
      if (!validIds.has(id)) {
        throw new BizException(BizCode.BAD_REQUEST, `Tập không thuộc drama: ${id}`);
      }
    }
    if (ids.length !== episodes.length) {
      throw new BizException(BizCode.BAD_REQUEST, '排序列表须包含全部当前分集');
    }
    await this.prisma.$transaction(async (tx) => {
      // 两阶段编号避免交换 1/2 集时触发 (dramaId, episodeNumber) 临时唯一键冲突。
      for (let i = 0; i < ids.length; i++) {
        await tx.episode.update({
          where: { id: BigInt(ids[i]) },
          data: { episodeNumber: -(i + 1) },
        });
      }
      for (let i = 0; i < ids.length; i++) {
        await tx.episode.update({
          where: { id: BigInt(ids[i]) },
          data: { episodeNumber: i + 1 },
        });
      }
    });
    await this.audit.write({
      actorId,
      action: 'episode.reorder',
      targetType: 'drama',
      targetId: dramaId,
      payload: { ids },
    });
    return { ok: true, count: ids.length };
  }

  async retryTranscode(
    id: string,
    actorId?: bigint,
    opts?: {
      preferR2?: boolean;
      watermarkEnabled?: boolean;
      watermarkX?: number;
      watermarkY?: number;
      watermarkScale?: number;
    },
  ) {
    const ep = await this.prisma.episode.findUnique({ where: { id: BigInt(id) } });
    if (!ep) throw new BizException(BizCode.NOT_FOUND, 'episode.notFound');
    const inputRel = ep.originalUrl || ep.hlsUrl;
    if (!inputRel || /^https?:\/\//i.test(inputRel)) {
      throw new BizException(BizCode.BAD_REQUEST, '无可转码的本地源文件，请重新上传视频');
    }
    const abs = this.upload.resolveAbs(inputRel);
    if (!fs.existsSync(abs)) {
      throw new BizException(BizCode.BAD_REQUEST, '源文件不存在，请重新上传视频');
    }
    await this.prisma.episode.update({
      where: { id: ep.id },
      data: { transcodeStatus: 'PENDING' },
    });
    const job = await this.upload.enqueueTranscode(inputRel, String(ep.id), opts);
    await this.audit.write({
      actorId,
      action: 'episode.transcode.retry',
      targetType: 'episode',
      targetId: id,
      payload: {
        from: ep.transcodeStatus,
        to: 'PENDING',
        jobId: job.id,
        watermarkEnabled: !!opts?.watermarkEnabled,
      },
    });
    return {
      id: ep.id.toString(),
      transcodeStatus: 'PENDING' as const,
      jobId: job.id,
    };
  }

  async firstFrame(id: string) {
    const ep = await this.prisma.episode.findUnique({ where: { id: BigInt(id) } });
    if (!ep) throw new BizException(BizCode.NOT_FOUND, 'episode.notFound');
    const inputRel = ep.originalUrl || ep.hlsUrl;
    if (!inputRel) {
      throw new BizException(BizCode.BAD_REQUEST, '无可抽取首帧的本地源文件');
    }
    return this.upload.extractFirstFrame(inputRel);
  }

  private assertHostedUploadAllowed(sourceType: string) {
    if (sourceType === 'ONLINE') {
      throw new BizException(
        BizCode.BAD_REQUEST,
        '外链播放剧不可上传本地文件；请粘贴外链、用公开页追加，或另建「转存托管 / 本地上传」作品',
      );
    }
  }

  private assertOnlineHttpMedia(raw: string) {
    const value = String(raw || '').trim();
    if (!/^https?:\/\//i.test(value)) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        '外链播放剧仅支持 http(s) 播放地址，不可写入本地托管路径',
      );
    }
  }

  private resolveMediaUrls(dto: {
    sourceUrl?: string;
    hlsUrl?: string;
    originalUrl?: string;
  }): { hlsUrl: string | null; originalUrl: string | null } {
    const source = dto.sourceUrl?.trim();
    if (source) {
      try {
        const { playUrl, originalUrl } = convertExternalPlayUrl(source);
        return { hlsUrl: playUrl, originalUrl };
      } catch (e: any) {
        throw new BizException(BizCode.BAD_REQUEST, e?.message || '无效播放地址');
      }
    }
    const hlsUrl = dto.hlsUrl?.trim() || null;
    const originalUrl = dto.originalUrl?.trim() || hlsUrl;
    return { hlsUrl, originalUrl };
  }

  private serialize(ep: {
    id: bigint;
    episodeNumber: number;
    title: string | null;
    isFree: boolean;
    priceCredits: bigint;
    priceVnd: bigint;
    thumbnailUrl: string | null;
    hlsUrl: string | null;
    originalUrl: string | null;
    transcodeStatus: string;
    uploadStatus: string;
    viewCount: bigint;
    unlockCount: bigint;
    durationSec?: number;
  }) {
    return {
      id: ep.id.toString(),
      episodeNumber: ep.episodeNumber,
      title: ep.title,
      isFree: ep.isFree,
      priceCredits: ep.priceCredits.toString(),
      priceVnd: ep.priceVnd.toString(),
      thumbnailUrl: ep.thumbnailUrl,
      hlsUrl: ep.hlsUrl,
      originalUrl: ep.originalUrl,
      transcodeStatus: ep.transcodeStatus,
      uploadStatus: ep.uploadStatus,
      durationSec: ep.durationSec ?? 0,
      viewCount: ep.viewCount.toString(),
      unlockCount: ep.unlockCount.toString(),
    };
  }
}

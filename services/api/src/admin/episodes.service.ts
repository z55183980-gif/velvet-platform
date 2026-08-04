import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import { AuditService } from '../common/audit.service';
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

    const isFree = !!dto.isFree;
    const priceCredits = isFree ? 0n : toBigIntCredits(dto.priceCredits, 0n);
    const priceVnd = isFree ? 0n : toBigIntCredits(dto.priceVnd ?? dto.priceCredits, 0n);
    if (!isFree && priceCredits <= 0n && priceVnd <= 0n) {
      throw new BizException(BizCode.BAD_REQUEST, '付费集需设置积分价 > 0');
    }

    const urls = this.resolveMediaUrls(dto);
    const ep = await this.prisma.$transaction(async (tx) => {
      const created = await tx.episode.create({
        data: {
          dramaId: drama.id,
          episodeNumber,
          title: dto.title?.trim() || `第${episodeNumber}集`,
          isFree,
          priceCredits,
          priceVnd,
          thumbnailUrl: dto.thumbnailUrl?.trim() || null,
          hlsUrl: urls.hlsUrl,
          originalUrl: urls.originalUrl,
          uploadStatus: urls.hlsUrl || urls.originalUrl ? 'COMPLETED' : 'PENDING',
          transcodeStatus: urls.hlsUrl?.endsWith('.m3u8')
            ? 'COMPLETED'
            : urls.originalUrl || urls.hlsUrl
              ? 'PENDING'
              : 'PENDING',
        },
      });
      await tx.drama.update({
        where: { id: drama.id },
        data: { totalEpisodes: { increment: 1 } },
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
    const ep = await this.prisma.episode.findUnique({ where: { id: BigInt(id) } });
    if (!ep) throw new BizException(BizCode.NOT_FOUND, 'episode.notFound');
    const data: Record<string, unknown> = {};
    if (dto.title != null) data.title = dto.title;
    if (dto.isFree != null) {
      data.isFree = !!dto.isFree;
      if (data.isFree) {
        data.priceCredits = 0n;
        data.priceVnd = 0n;
      }
    }
    if (dto.priceCredits != null) data.priceCredits = toBigIntCredits(dto.priceCredits);
    if (dto.priceVnd != null) data.priceVnd = toBigIntCredits(dto.priceVnd);
    if (dto.thumbnailUrl != null) data.thumbnailUrl = dto.thumbnailUrl;
    if (dto.transcodeStatus != null) data.transcodeStatus = dto.transcodeStatus;

    if (dto.sourceUrl != null || dto.hlsUrl != null || dto.originalUrl != null) {
      const urls = this.resolveMediaUrls({
        sourceUrl: dto.sourceUrl,
        hlsUrl: dto.hlsUrl ?? ep.hlsUrl ?? undefined,
        originalUrl: dto.originalUrl ?? ep.originalUrl ?? undefined,
      });
      data.hlsUrl = urls.hlsUrl;
      data.originalUrl = urls.originalUrl;
      if (urls.hlsUrl || urls.originalUrl) {
        data.uploadStatus = 'COMPLETED';
        if (urls.hlsUrl?.endsWith('.m3u8')) {
          data.transcodeStatus = 'COMPLETED';
        } else if (dto.transcodeStatus == null) {
          data.transcodeStatus = 'PENDING';
        }
      }
    }

    if (Object.keys(data).length === 0) {
      throw new BizException(BizCode.BAD_REQUEST, 'common.noFieldsToUpdate');
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
    const ep = await this.prisma.episode.findUnique({ where: { id: BigInt(id) } });
    if (!ep) throw new BizException(BizCode.NOT_FOUND, 'episode.notFound');

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
      await tx.drama.update({
        where: { id: ep.dramaId },
        data: { totalEpisodes: remaining.length },
      });
    });

    await this.audit.write({
      actorId,
      action: 'episode.delete',
      targetType: 'episode',
      targetId: id,
      payload: { dramaId: ep.dramaId.toString(), episodeNumber: ep.episodeNumber },
    });
    return { ok: true };
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

  async retryTranscode(id: string, actorId?: bigint) {
    const ep = await this.prisma.episode.findUnique({ where: { id: BigInt(id) } });
    if (!ep) throw new BizException(BizCode.NOT_FOUND, 'episode.notFound');
    const updated = await this.prisma.episode.update({
      where: { id: BigInt(id) },
      data: { transcodeStatus: 'PENDING' },
    });
    await this.audit.write({
      actorId,
      action: 'episode.transcode.retry',
      targetType: 'episode',
      targetId: id,
      payload: { from: ep.transcodeStatus, to: 'PENDING' },
    });
    return { id: updated.id.toString(), transcodeStatus: updated.transcodeStatus };
  }

  private resolveMediaUrls(dto: {
    sourceUrl?: string;
    hlsUrl?: string;
    originalUrl?: string;
  }): { hlsUrl: string | null; originalUrl: string | null } {
    const source = dto.sourceUrl?.trim();
    if (source) {
      try {
        const { playUrl, originalUrl } = convertExternalPlayUrl(source, { relaxed: true });
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

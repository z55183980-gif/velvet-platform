import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import { AuditService } from '../common/audit.service';

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

  async update(
    id: string,
    dto: {
      title?: string;
      isFree?: boolean;
      priceCredits?: number | string;
      priceVnd?: number | string;
      thumbnailUrl?: string;
      transcodeStatus?: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    },
    actorId?: bigint,
  ) {
    const ep = await this.prisma.episode.findUnique({ where: { id: BigInt(id) } });
    if (!ep) throw new BizException(BizCode.NOT_FOUND, 'Không tìm thấy tập');
    const data: any = {};
    if (dto.title != null) data.title = dto.title;
    if (dto.isFree != null) {
      data.isFree = !!dto.isFree;
      if (data.isFree) {
        data.priceCredits = 0n;
        data.priceVnd = 0n;
      }
    }
    if (dto.priceCredits != null) data.priceCredits = BigInt(Math.floor(Number(dto.priceCredits)));
    if (dto.priceVnd != null) data.priceVnd = BigInt(Math.floor(Number(dto.priceVnd)));
    if (dto.thumbnailUrl != null) data.thumbnailUrl = dto.thumbnailUrl;
    if (dto.transcodeStatus != null) data.transcodeStatus = dto.transcodeStatus;
    if (Object.keys(data).length === 0) {
      throw new BizException(BizCode.BAD_REQUEST, 'Không có trường nào để cập nhật');
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
    if (!ep) throw new BizException(BizCode.NOT_FOUND, 'Không tìm thấy tập');
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

  private serialize(ep: any) {
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
      viewCount: ep.viewCount.toString(),
      unlockCount: ep.unlockCount.toString(),
    };
  }
}

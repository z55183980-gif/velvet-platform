import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { BizException, BizCode } from '../common/biz.exception';
import { ConfigService } from '@nestjs/config';
import { toBigInt } from '../common/money.util';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  IMPORT_CATEGORIES,
  listDramaDirs,
  listVideoFiles,
  pickCoverFile,
  resolveDramaDef,
  normName,
} from './local-import.util';
import { convertExternalPlayUrl, inferExternalUrlExpiry, manualExternalRef, manualExternalVideoId, slugifyTitle } from './online-drama.util';
import { AuditService } from '../common/audit.service';
import { UploadService } from '../upload/upload.service';
import { ContentReadinessService } from '../common/content-readiness.service';
import { PlatformSettingsService } from '../common/platform-settings.service';
import { mergeDramaSourceTags } from '../dramas/drama-tags';

export interface LocalImportOptions {
  rootPath?: string;
  dryRun?: boolean;
  /** 写入 DB 的媒体相对路径前缀（相对 STORAGE_ROOT），如 `imports/{batchId}` */
  mediaPrefix?: string;
  /** 指定后把扫描到的视频追加到该剧，而不是按子目录新建剧 */
  targetDramaId?: string;
}

export interface LocalImportItemResult {
  folder: string;
  slug: string;
  titleZh: string;
  action: 'imported' | 'skipped' | 'would_import' | 'appended' | 'would_append' | 'error';
  reason?: string;
  episodes?: number;
  dramaId?: string;
  fromEpisode?: number;
  toEpisode?: number;
}

export interface OnlineEpisodeInput {
  sourceUrl: string;
  sourcePageUrl?: string;
  sourceProvider?: string;
  externalVideoId?: string;
  playlistIndex?: number;
  title?: string;
  episodeNumber?: number;
  isFree?: boolean;
}

export interface CreateOnlineDramaInput {
  titleZh: string;
  titleEn?: string;
  slug?: string;
  descriptionZh?: string;
  descriptionEn?: string;
  categorySlug: string;
  coverUrl?: string;
  freeEpisodeCount?: number;
  lockMode?: 'FREE_FIRST_N' | 'VIP_ALL' | 'ALL_FREE';
  /** Ignored — online dramas always create as DRAFT (rights gate). */
  status?: 'DRAFT';
  /** 外部来源去重键，如 ytdlp:{extractor}:{id}；缺省时按分集 URL 生成 manual:… */
  externalRef?: string;
  sourceTags?: string[];
  /** 第三方解析结果允许非扩展名直链 */
  relaxedPlayUrl?: boolean;
  episodes: OnlineEpisodeInput[];
}

export interface CreateLocalUploadDramaInput {
  titleZh: string;
  titleEn?: string;
  slug?: string;
  descriptionZh?: string;
  descriptionEn?: string;
  categorySlug: string;
  coverUrl?: string;
  freeEpisodeCount?: number;
  lockMode?: 'FREE_FIRST_N' | 'VIP_ALL' | 'ALL_FREE';
  /** Ignored — upload shells always create as DRAFT. */
  status?: 'DRAFT';
  sourceTags?: string[];
  /** local disk vs R2 CDN shell — listing filters use this. */
  sourceType?: 'LOCAL' | 'R2';
  /** Dedup key for transferred/online sources */
  externalRef?: string;
  /** Announced/planned total; kept ahead of uploaded count for consumer placeholders. */
  totalEpisodes?: number;
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  private readonly pitRateEnvFallback: number;
  private readonly defaultImportRoot: string;
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly upload: UploadService,
    private readonly readiness: ContentReadinessService,
    private readonly platformSettings: PlatformSettingsService,
  ) {
    this.pitRateEnvFallback = Number(config.get('PIT_RATE') || 0.05);
    this.defaultImportRoot =
      config.get<string>('ADMIN_IMPORT_ROOT') ||
      config.get<string>('MEDIA_ROOT') ||
      '/Users/ahs/Downloads/演示历史成品';
  }

  async pendingDramas() {
    return this.prisma.drama.findMany({
      where: { status: 'PENDING_REVIEW' },
      orderBy: { createdAt: 'desc' },
      include: { creator: { select: { displayName: true } } },
    });
  }

  async approveDrama(id: string, actorId?: bigint | null) {
    const existing = await this.prisma.drama.findUnique({ where: { id: BigInt(id) } });
    if (!existing) throw new BizException(BizCode.NOT_FOUND, 'drama.notFound');
    if (existing.status !== 'PENDING_REVIEW') {
      throw new BizException(BizCode.CONFLICT, 'request.alreadyProcessed');
    }
    await this.readiness.assertDramaReady(existing.id);
    const drama = await this.prisma.drama.update({
      where: { id: BigInt(id) },
      data: { status: 'LIVE', publishedAt: new Date() },
    });
    await this.audit.write({
      actorId,
      action: 'drama.approve',
      targetType: 'drama',
      targetId: drama.id,
      payload: { from: existing.status, to: drama.status },
    });
    return { id: drama.id.toString(), status: drama.status };
  }

  async rejectDrama(id: string, reason?: string, actorId?: bigint | null) {
    const existing = await this.prisma.drama.findUnique({ where: { id: BigInt(id) } });
    if (!existing) throw new BizException(BizCode.NOT_FOUND, 'drama.notFound');
    if (existing.status !== 'PENDING_REVIEW') {
      throw new BizException(BizCode.CONFLICT, 'request.alreadyProcessed');
    }
    const drama = await this.prisma.drama.update({
      where: { id: BigInt(id) },
      data: { status: 'REJECTED' },
    });
    await this.audit.write({
      actorId,
      action: 'drama.reject',
      targetType: 'drama',
      targetId: drama.id,
      payload: { reason, from: existing.status, to: drama.status },
    });
    return { id: drama.id.toString(), status: drama.status, reason };
  }

  async pendingCreators() {
    const rows = await this.prisma.creator.findMany({
      where: { kycStatus: 'PENDING' },
      include: { user: { select: { email: true, phone: true } } },
      orderBy: { id: 'asc' },
    });
    return rows.map((c) => ({
      id: c.id.toString(),
      displayName: c.displayName,
      kycStatus: c.kycStatus,
      user: c.user,
      userId: c.userId.toString(),
    }));
  }

  async approveKyc(creatorId: string, actorId?: bigint | null) {
    const existing = await this.prisma.creator.findUnique({ where: { id: BigInt(creatorId) } });
    if (!existing) throw new BizException(BizCode.NOT_FOUND, 'creator.notFound');
    if (existing.kycStatus !== 'PENDING') {
      throw new BizException(BizCode.CONFLICT, 'kyc.alreadyProcessed');
    }
    const c = await this.prisma.creator.update({
      where: { id: BigInt(creatorId) },
      data: {
        kycStatus: 'APPROVED',
        kycRejectReason: null,
        faceVerified: true,
        bankVerified: true,
      },
    });
    await this.audit.write({
      actorId,
      action: 'kyc.approve',
      targetType: 'creator',
      targetId: c.id,
      payload: { from: existing.kycStatus, to: c.kycStatus },
    });
    await this.notifyCreator(c.userId, 'kyc.approved', {
      titleEn: 'KYC approved',
      titleZh: 'KYC 已通过',
      bodyEn: 'Identity verified. You can request withdrawals when earnings are available.',
      bodyZh: '身份已通过审核，收益可用时可申请提现。',
    });
    return { creatorId: c.id.toString(), kycStatus: c.kycStatus };
  }

  async rejectKyc(creatorId: string, reason?: string, actorId?: bigint | null) {
    if (!reason || !String(reason).trim()) {
      throw new BizException(BizCode.BAD_REQUEST, 'common.rejectReasonRequired');
    }
    const existing = await this.prisma.creator.findUnique({ where: { id: BigInt(creatorId) } });
    if (!existing) throw new BizException(BizCode.NOT_FOUND, 'creator.notFound');
    if (existing.kycStatus !== 'PENDING') {
      throw new BizException(BizCode.CONFLICT, 'kyc.alreadyProcessed');
    }
    const c = await this.prisma.creator.update({
      where: { id: BigInt(creatorId) },
      data: { kycStatus: 'REJECTED', kycRejectReason: String(reason).trim() },
    });
    await this.audit.write({
      actorId,
      action: 'kyc.reject',
      targetType: 'creator',
      targetId: c.id,
      payload: { reason, from: existing.kycStatus, to: c.kycStatus },
    });
    await this.notifyCreator(c.userId, 'kyc.rejected', {
      titleEn: 'KYC rejected',
      titleZh: 'KYC 被拒绝',
      bodyEn: `Reason: ${reason}`,
      bodyZh: `原因：${reason}`,
    });
    return {
      creatorId: c.id.toString(),
      kycStatus: c.kycStatus,
      rejectReason: c.kycRejectReason,
    };
  }

  private async notifyCreator(
    userId: bigint,
    type: string,
    content: {
      titleEn: string;
      titleZh?: string;
      bodyEn?: string;
      bodyZh?: string;
    },
  ) {
    try {
      await this.prisma.notification.create({
        data: {
          userId,
          type,
          titleEn: content.titleEn,
          titleZh: content.titleZh ?? null,
          bodyEn: content.bodyEn ?? null,
          bodyZh: content.bodyZh ?? null,
        },
      });
    } catch {
      /* ignore */
    }
  }

  async pendingWithdraws(overdueHours?: number) {
    const where: { status: 'PENDING'; createdAt?: { lt: Date } } = { status: 'PENDING' };
    if (overdueHours != null && Number.isFinite(overdueHours) && overdueHours > 0) {
      where.createdAt = {
        lt: new Date(Date.now() - overdueHours * 60 * 60 * 1000),
      };
    }
    const rows = await this.prisma.withdrawRequest.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: { creator: { select: { displayName: true, taxCode: true } } },
    });
    const thresholdMs = (overdueHours && overdueHours > 0 ? overdueHours : 24) * 60 * 60 * 1000;
    const now = Date.now();
    return rows.map((r) => ({
      ...r,
      overdue: now - r.createdAt.getTime() > thresholdMs,
      waitingHours: Math.floor((now - r.createdAt.getTime()) / 3600000),
    }));
  }

  async approveWithdraw(id: string, actorId?: bigint | null) {
    const req = await this.prisma.withdrawRequest.findUnique({ where: { id: BigInt(id) } });
    if (!req) throw new BizException(BizCode.NOT_FOUND, 'request.notFound');
    if (req.status !== 'PENDING') {
      throw new BizException(BizCode.CONFLICT, 'request.alreadyProcessed');
    }
    const pitRate = await this.platformSettings.getPitRate(this.pitRateEnvFallback);
    const pitVnd = toBigInt(Math.floor(Number(req.amountVnd) * pitRate));
    const netVnd = req.amountVnd - pitVnd;

    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.withdrawRequest.updateMany({
        where: { id: req.id, status: 'PENDING' },
        data: { status: 'PAID', paidAt: new Date(), pitRate, pitVnd, netVnd },
      });
      if (claimed.count !== 1) {
        throw new BizException(BizCode.CONFLICT, 'request.alreadyProcessed');
      }
      await tx.creatorEarning.update({
        where: { creatorId: req.creatorId },
        data: { withdrawnVnd: { increment: req.amountVnd } },
      });
      return tx.withdrawRequest.findUniqueOrThrow({ where: { id: req.id } });
    });
    await this.audit.write({
      actorId,
      action: 'withdraw.paid',
      targetType: 'withdraw',
      targetId: result.id,
      payload: {
        amountVnd: result.amountVnd.toString(),
        pitVnd: pitVnd.toString(),
        netVnd: netVnd.toString(),
      },
    });
    return {
      id: result.id.toString(),
      status: result.status,
      pitVnd: pitVnd.toString(),
      netVnd: netVnd.toString(),
    };
  }

  async rejectWithdraw(id: string, reason?: string, actorId?: bigint | null) {
    if (!reason || !String(reason).trim()) {
      throw new BizException(BizCode.BAD_REQUEST, 'common.rejectReasonRequired');
    }
    const req = await this.prisma.withdrawRequest.findUnique({ where: { id: BigInt(id) } });
    if (!req) throw new BizException(BizCode.NOT_FOUND, 'request.notFound');
    if (req.status !== 'PENDING') {
      throw new BizException(BizCode.CONFLICT, 'request.alreadyProcessed');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.withdrawRequest.updateMany({
        where: { id: req.id, status: 'PENDING' },
        data: { status: 'REJECTED', rejectReason: String(reason).trim() },
      });
      if (claimed.count !== 1) {
        throw new BizException(BizCode.CONFLICT, 'request.alreadyProcessed');
      }
      await tx.creatorEarning.update({
        where: { creatorId: req.creatorId },
        data: { availableVnd: { increment: req.amountVnd } },
      });
      return tx.withdrawRequest.findUniqueOrThrow({ where: { id: req.id } });
    });
    await this.audit.write({
      actorId,
      action: 'withdraw.reject',
      targetType: 'withdraw',
      targetId: result.id,
      payload: { reason: String(reason).trim(), amountVnd: result.amountVnd.toString() },
    });
    return { id: result.id.toString(), status: result.status };
  }

  async statsOverview() {
    const [
      userCnt,
      dramaCnt,
      creatorCnt,
      pendingDrama,
      pendingCreator,
      pendingWithdraw,
      paidAgg,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.drama.count(),
      this.prisma.creator.count(),
      this.prisma.drama.count({ where: { status: 'PENDING_REVIEW' } }),
      this.prisma.creator.count({ where: { kycStatus: 'PENDING' } }),
      this.prisma.withdrawRequest.count({ where: { status: 'PENDING' } }),
      this.prisma.order.aggregate({
        where: { paymentStatus: 'PAID' },
        _sum: { amountVnd: true, platformFeeVnd: true },
        _count: { id: true },
      }),
    ]);
    return {
      users: userCnt,
      dramas: dramaCnt,
      creators: creatorCnt,
      pendingDramas: pendingDrama,
      pendingCreators: pendingCreator,
      pendingWithdraws: pendingWithdraw,
      gmvVnd: (paidAgg._sum.amountVnd ?? 0n).toString(),
      platformRevenueVnd: (paidAgg._sum.platformFeeVnd ?? 0n).toString(),
      paidOrders: paidAgg._count.id,
    };
  }

  /** 银行转账兜底：管理员人工确认入账（参数为 orderNo） */
  async markPaid(orderNo: string, externalRef?: string, actorId?: bigint | null) {
    const order = await this.prisma.order.findUnique({ where: { orderNo } });
    if (!order) throw new BizException(BizCode.NOT_FOUND, 'order.notFound');
    if (order.paymentStatus === 'REFUNDED') {
      throw new BizException(
        BizCode.CONFLICT,
        'order.alreadyRefundedCannotMarkPaid',
      );
    }
    if (order.paymentStatus === 'PAID') {
      return { alreadyPaid: true, orderNo: order.orderNo, status: order.paymentStatus };
    }
    await this.audit.write({
      actorId,
      action: 'order.markPaid',
      targetType: 'order',
      targetId: orderNo,
      payload: { externalRef, prevStatus: order.paymentStatus },
    });
    return this.wallet.creditOnPaid(orderNo, { externalRef });
  }

  async listReconciliations(page = 1, pageSize = 30) {
    const [rows, total] = await Promise.all([
      this.prisma.paymentReconciliation.findMany({
        orderBy: { date: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.paymentReconciliation.count(),
    ]);
    return { rows, total, page, pageSize };
  }

  private storageRoot(): string {
    return path.resolve(
      this.config.get<string>('STORAGE_ROOT') || path.join(process.cwd(), 'storage'),
    );
  }

  /**
   * 浏览器选中文件夹上传后批量导入：写入 storage/imports/{batchId}/，
   * 再走 importLocal，媒体路径带 imports/{batchId} 前缀以便 MEDIA 解析。
   */
  async importUploadedFiles(
    files: Express.Multer.File[],
    relativePaths: string[],
    dryRun = false,
    targetDramaId?: string,
  ) {
    if (!files?.length) {
      throw new BizException(BizCode.BAD_REQUEST, '未收到上传文件');
    }
    if (relativePaths.length && relativePaths.length !== files.length) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        `relativePaths 数量(${relativePaths.length})与 files(${files.length})不一致`,
      );
    }

    const batchId = crypto.randomUUID();
    const mediaPrefix = `imports/${batchId}`;
    const batchRoot = path.join(this.storageRoot(), 'imports', batchId);
    fs.mkdirSync(batchRoot, { recursive: true });

    const strippedPaths = this.normalizeUploadRelativePaths(
      files.map((f, i) => relativePaths[i] || f.originalname || `file-${i}`),
    );

    for (let i = 0; i < files.length; i++) {
      const rel = strippedPaths[i];
      if (!rel) continue;
      const dest = path.join(batchRoot, rel);
      const destDir = path.dirname(dest);
      if (!dest.startsWith(batchRoot + path.sep) && dest !== batchRoot) {
        throw new BizException(BizCode.BAD_REQUEST, `非法相对路径: ${rel}`);
      }
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(dest, files[i].buffer);
    }

    const result = await this.importLocal({
      rootPath: batchRoot,
      dryRun,
      mediaPrefix,
      targetDramaId,
    });
    return { ...result, batchId, mediaPrefix, filesWritten: files.length };
  }

  /**
   * webkitRelativePath 形如 `演示历史成品/末世之约/a.mp4` 时剥掉顶层选中目录名，
   * 使剧文件夹直接落在 batchRoot 下；已是 `末世之约/a.mp4` 则原样。
   */
  private normalizeUploadRelativePaths(rawPaths: string[]): string[] {
    const normalized = rawPaths.map((p) =>
      String(p || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .split('/')
        .filter((seg) => seg && seg !== '.' && seg !== '..')
        .join('/'),
    );

    const nonempty = normalized.filter(Boolean);
    if (!nonempty.length) return normalized;

    const tops = nonempty.map((p) => p.split('/')[0]);
    const commonTop = tops[0];
    if (!tops.every((t) => t === commonTop)) return normalized;

    const stripped = normalized.map((p) => {
      if (!p) return p;
      const parts = p.split('/');
      if (parts[0] !== commonTop) return p;
      return parts.slice(1).join('/');
    });

    // 剥离后仍须保留「剧文件夹/文件」结构（至少一个路径含 /），否则说明顶层本身就是剧目录
    if (stripped.every((p, i) => !normalized[i] || p.length > 0) && stripped.some((p) => p.includes('/'))) {
      return stripped;
    }
    return normalized;
  }

  /**
   * 将单个剧文件夹内的视频追加到已有剧（集号接在当前最大集之后）。
   * 支持：root 下直接放视频，或 root 下恰好一个子文件夹。
   */
  private async appendLocalVideosToDrama(opts: {
    rootPath: string;
    dryRun: boolean;
    mediaPrefix: string;
    targetDramaId: string;
  }) {
    const { rootPath, dryRun, mediaPrefix, targetDramaId } = opts;
    if (!/^\d+$/.test(targetDramaId)) {
      throw new BizException(BizCode.BAD_REQUEST, 'targetDramaId 无效');
    }

    const drama = await this.prisma.drama.findUnique({
      where: { id: BigInt(targetDramaId) },
      select: {
        id: true,
        slug: true,
        titleZh: true,
        titleEn: true,
        coverUrl: true,
        freeEpisodeCount: true,
        lockMode: true,
      },
    });
    if (!drama) throw new BizException(BizCode.NOT_FOUND, 'drama.notFound');

    let folderAbs = rootPath;
    let folderLabel = path.basename(rootPath);
    let videos = listVideoFiles(rootPath);

    if (!videos.length) {
      const dirs = listDramaDirs(rootPath);
      if (dirs.length > 1) {
        throw new BizException(
          BizCode.BAD_REQUEST,
          '挂到已有剧时请选择单部剧文件夹（内含视频），不要选择多剧根目录',
        );
      }
      if (dirs.length === 1) {
        folderLabel = dirs[0];
        folderAbs = path.join(rootPath, dirs[0]);
        videos = listVideoFiles(folderAbs);
      }
    }

    if (!videos.length) {
      return {
        rootPath,
        dryRun,
        scanned: 1,
        imported: 0,
        skipped: 1,
        errors: 0,
        items: [
          {
            folder: folderLabel,
            slug: drama.slug,
            titleZh: drama.titleZh || drama.titleEn || drama.slug,
            action: 'skipped' as const,
            reason: '无视频文件',
            dramaId: drama.id.toString(),
          },
        ],
        hint: '已指定已有剧，但目录中未找到视频。',
      };
    }

    const maxAgg = await this.prisma.episode.aggregate({
      where: { dramaId: drama.id },
      _max: { episodeNumber: true },
    });
    const startEp = (maxAgg._max.episodeNumber ?? 0) + 1;
    const endEp = startEp + videos.length - 1;

    const paidSample = await this.prisma.episode.findFirst({
      where: { dramaId: drama.id, isFree: false },
      select: { priceCredits: true, priceVnd: true },
      orderBy: { episodeNumber: 'desc' },
    });
    const paidCredits = paidSample?.priceCredits && paidSample.priceCredits > 0n
      ? paidSample.priceCredits
      : 10n;
    const paidVnd = paidSample?.priceVnd && paidSample.priceVnd > 0n
      ? paidSample.priceVnd
      : paidCredits;

    const freeCount = Math.max(0, drama.freeEpisodeCount ?? 0);
    const lockMode = drama.lockMode || 'FREE_FIRST_N';
    const episodeIsFree = (ep: number) => {
      if (lockMode === 'ALL_FREE') return true;
      if (lockMode === 'VIP_ALL') return false;
      return ep <= freeCount;
    };

    const titleZh = drama.titleZh || drama.titleEn || drama.slug;
    if (dryRun) {
      return {
        rootPath,
        dryRun: true,
        scanned: 1,
        imported: 1,
        skipped: 0,
        errors: 0,
        items: [
          {
            folder: folderLabel,
            slug: drama.slug,
            titleZh,
            action: 'would_append' as const,
            episodes: videos.length,
            dramaId: drama.id.toString(),
            fromEpisode: startEp,
            toEpisode: endEp,
          },
        ],
        hint: `将追加到已有剧「${titleZh}」第 ${startEp}–${endEp} 集。`,
      };
    }

    const coverFile = pickCoverFile(folderAbs);
    const mediaRel = (fileName: string) => {
      const relFromRoot = path
        .relative(rootPath, path.join(folderAbs, fileName))
        .split(path.sep)
        .join('/');
      return mediaPrefix ? `${mediaPrefix}/${relFromRoot}` : relFromRoot;
    };
    const coverUrl = coverFile
      ? `/api/v1/media/${mediaRel(coverFile)
          .split('/')
          .map((s) => encodeURIComponent(s))
          .join('/')}`
      : null;

    for (let i = 0; i < videos.length; i++) {
      const f = videos[i];
      const ep = startEp + i;
      const isFree = episodeIsFree(ep);
      const rel = mediaRel(f);
      await this.prisma.episode.create({
        data: {
          dramaId: drama.id,
          episodeNumber: ep,
          title: `Episode ${ep}`,
          isFree,
          priceVnd: isFree ? 0n : paidVnd,
          priceCredits: isFree ? 0n : paidCredits,
          durationSec: 120,
          hlsUrl: rel,
          thumbnailUrl: coverUrl,
          uploadStatus: 'COMPLETED',
          transcodeStatus: 'COMPLETED',
        },
      });
    }

    const total = await this.prisma.episode.count({ where: { dramaId: drama.id } });
    await this.prisma.drama.update({
      where: { id: drama.id },
      data: {
        totalEpisodes: total,
        ...(coverUrl && !drama.coverUrl ? { coverUrl } : {}),
      },
    });

    this.logger.log(
      `local-import append: drama=${drama.id} +${videos.length} eps → ${startEp}-${endEp}`,
    );

    return {
      rootPath,
      dryRun: false,
      scanned: 1,
      imported: 1,
      skipped: 0,
      errors: 0,
      items: [
        {
          folder: folderLabel,
          slug: drama.slug,
          titleZh,
          action: 'appended' as const,
          episodes: videos.length,
          dramaId: drama.id.toString(),
          fromEpisode: startEp,
          toEpisode: endEp,
        },
      ],
      hint: `已追加到「${titleZh}」第 ${startEp}–${endEp} 集。`,
    };
  }

  /**
   * 管理员本地目录批量导入：扫描 rootPath 下每个子文件夹为一剧，
   * 按 slug / titleZh / 归一化文件夹名去重；幂等，已存在则 skip。
   * 若指定 targetDramaId，则把目录内视频追加到该剧（单部剧文件夹）。
   */
  async importLocal(opts: LocalImportOptions = {}) {
    const rootPath = path.resolve(opts.rootPath || this.defaultImportRoot);
    const dryRun = !!opts.dryRun;
    const mediaPrefix = (opts.mediaPrefix || '').replace(/^\/+|\/+$/g, '');

    if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
      throw new BizException(BizCode.BAD_REQUEST, `导入目录不存在: ${rootPath}`);
    }

    if (opts.targetDramaId?.trim()) {
      return this.appendLocalVideosToDrama({
        rootPath,
        dryRun,
        mediaPrefix,
        targetDramaId: opts.targetDramaId.trim(),
      });
    }

    for (const c of IMPORT_CATEGORIES) {
      await this.prisma.category.upsert({
        where: { slug: c.slug },
        create: c,
        update: { nameEn: c.nameEn, nameZh: c.nameZh },
      });
    }

    let creator = await this.prisma.creator.findFirst({
      where: { kycStatus: 'APPROVED' },
      orderBy: { id: 'asc' },
    });
    if (!creator) {
      creator = await this.prisma.creator.findFirst();
    }
    if (!creator) {
      const u = await this.prisma.user.upsert({
        where: { email: 'sample@velvet.dev' },
        create: { email: 'sample@velvet.dev', nickname: 'Sample Studio' },
        update: {},
      });
      creator = await this.prisma.creator.create({
        data: {
          userId: u.id,
          creatorType: 'INDIVIDUAL',
          displayName: 'Sample Studio',
          revenueShare: await this.platformSettings.getRevenueShareDefault(),
          kycStatus: 'APPROVED',
        },
      });
    }

    const dirs = listDramaDirs(rootPath);
    const items: LocalImportItemResult[] = [];
    let imported = 0;
    let skipped = 0;
    let errors = 0;

    const existingDramas = await this.prisma.drama.findMany({
      select: { id: true, slug: true, titleZh: true },
    });
    const bySlug = new Map(existingDramas.map((d) => [d.slug, d]));
    const byTitleNorm = new Map(
      existingDramas
        .filter((d) => d.titleZh)
        .map((d) => [normName(d.titleZh!), d]),
    );

    for (const dir of dirs) {
      const def = resolveDramaDef(dir);
      try {
        const dup =
          bySlug.get(def.slug) ||
          byTitleNorm.get(normName(def.titleZh)) ||
          byTitleNorm.get(normName(dir)) ||
          null;

        if (dup) {
          skipped += 1;
          items.push({
            folder: dir,
            slug: def.slug,
            titleZh: def.titleZh,
            action: 'skipped',
            reason: `已存在 slug=${dup.slug} id=${dup.id}`,
            dramaId: dup.id.toString(),
          });
          continue;
        }

        const folderAbs = path.join(rootPath, dir);
        const videos = listVideoFiles(folderAbs);
        if (videos.length === 0) {
          skipped += 1;
          items.push({
            folder: dir,
            slug: def.slug,
            titleZh: def.titleZh,
            action: 'skipped',
            reason: '无视频文件',
          });
          continue;
        }

        if (dryRun) {
          imported += 1;
          items.push({
            folder: dir,
            slug: def.slug,
            titleZh: def.titleZh,
            action: 'would_import',
            episodes: videos.length,
          });
          continue;
        }

        const coverFile = pickCoverFile(folderAbs);
        const mediaRel = (fileName: string) =>
          mediaPrefix
            ? `${mediaPrefix}/${dir}/${fileName}`
            : `${dir}/${fileName}`;
        const coverUrl = coverFile
          ? `/api/v1/media/${mediaRel(coverFile)
              .split('/')
              .map((s) => encodeURIComponent(s))
              .join('/')}`
          : '';

        const drama = await this.prisma.drama.create({
          data: {
            creatorId: creator.id,
            slug: def.slug,
            titleEn: def.titleEn,
            titleZh: def.titleZh,
            descriptionEn: def.descEn || null,
            descriptionZh: def.descZh || null,
            categorySlug: def.category,
            coverUrl: coverUrl || null,
            freeEpisodeCount: def.freeCount,
            isOfficial: !!def.isOfficial,
            isFeatured: !!def.isFeatured,
            // 与上传/在线一致：导入先入草稿，经就绪检查后再恢复上架
            status: 'DRAFT',
            sourceType: 'LOCAL',
            publishedAt: null,
            totalEpisodes: videos.length,
            viewCount: 0n,
            unlockCount: 0n,
          },
        });

        for (let i = 0; i < videos.length; i++) {
          const f = videos[i];
          const ep = i + 1;
          const isFree = ep <= def.freeCount;
          const rel = mediaRel(f);
          await this.prisma.episode.create({
            data: {
              dramaId: drama.id,
              episodeNumber: ep,
              title: `Episode ${ep}`,
              isFree,
              priceVnd: isFree ? 0n : def.priceVnd,
              // 解锁按积分扣款；导入必须写 priceCredits，否则付费集会变成「0 积分仍上锁」
              priceCredits: isFree ? 0n : def.priceCredits,
              durationSec: 120,
              hlsUrl: rel,
              thumbnailUrl: coverUrl || null,
              uploadStatus: 'COMPLETED',
              transcodeStatus: 'COMPLETED',
            },
          });
        }

        imported += 1;
        items.push({
          folder: dir,
          slug: def.slug,
          titleZh: def.titleZh,
          action: 'imported',
          episodes: videos.length,
          dramaId: drama.id.toString(),
        });
        bySlug.set(def.slug, { id: drama.id, slug: def.slug, titleZh: def.titleZh });
        byTitleNorm.set(normName(def.titleZh), {
          id: drama.id,
          slug: def.slug,
          titleZh: def.titleZh,
        });
        this.logger.log(`local-import: ${def.titleZh} → ${videos.length} eps`);
      } catch (e: any) {
        errors += 1;
        items.push({
          folder: dir,
          slug: def.slug,
          titleZh: def.titleZh,
          action: 'error',
          reason: e?.message || String(e),
        });
        this.logger.error(`local-import failed: ${dir}`, e?.stack || e);
      }
    }

    return {
      rootPath,
      dryRun,
      scanned: dirs.length,
      imported,
      skipped,
      errors,
      items,
      hint:
        '媒体路径需落在 MEDIA_ROOT / ADMIN_IMPORT_ROOT / STORAGE_ROOT 下；' +
        '默认 MEDIA_ROOT 应指向导入根目录以便播放。',
    };
  }

  // ============ Banner CRUD ============
  /** Allow http(s) absolute URLs or same-site paths; reject admin shells / protocols. */
  private normalizeBannerLinkUrl(raw: unknown): string | null {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s) return null;
    if (s.startsWith('/') && !s.startsWith('//')) {
      if (/^\/(admin|ops|console)(\/|$)/i.test(s)) {
        throw new BizException(BizCode.BAD_REQUEST, 'validation.bannerLinkUrl');
      }
      return s;
    }
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      throw new BizException(BizCode.BAD_REQUEST, 'validation.bannerLinkUrl');
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new BizException(BizCode.BAD_REQUEST, 'validation.bannerLinkUrl');
    }
    return s;
  }

  private async resolveBannerDramaId(raw: unknown): Promise<bigint | null> {
    if (raw == null || raw === '') return null;
    const id = String(raw).trim();
    if (!/^\d+$/.test(id)) {
      throw new BizException(BizCode.BAD_REQUEST, 'validation.bannerDramaId');
    }
    const drama = await this.prisma.drama.findUnique({
      where: { id: BigInt(id) },
      select: { id: true },
    });
    if (!drama) throw new BizException(BizCode.NOT_FOUND, 'Drama không tồn tại');
    return drama.id;
  }

  async listBanners(all = false) {
    const where = all
      ? undefined
      : { isActive: true, startAt: { lte: new Date() }, endAt: { gte: new Date() } };
    const rows = await this.prisma.banner.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    return { rows, total: rows.length };
  }

  async createBanner(
    dto: {
      titleEn: string;
      titleZh?: string;
      imageUrl: string;
      linkUrl?: string;
      dramaId?: string;
      startAt: string;
      endAt: string;
      sortOrder?: number;
      isActive?: boolean;
    },
    actorId?: bigint,
  ) {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw new BizException(BizCode.BAD_REQUEST, 'startAt/endAt không hợp lệ');
    }
    if (endAt <= startAt) {
      throw new BizException(BizCode.BAD_REQUEST, 'validation.endAfterStart');
    }
    const linkUrl = this.normalizeBannerLinkUrl(dto.linkUrl);
    const dramaId = await this.resolveBannerDramaId(dto.dramaId);
    const banner = await this.prisma.banner.create({
      data: {
        titleEn: dto.titleEn,
        titleZh: dto.titleZh,
        imageUrl: dto.imageUrl,
        linkUrl,
        dramaId,
        startAt,
        endAt,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
    await this.audit.write({
      actorId,
      action: 'banner.create',
      targetType: 'banner',
      targetId: banner.id.toString(),
      payload: { titleEn: banner.titleEn },
    });
    return { id: banner.id.toString() };
  }

  async updateBanner(id: string, dto: any, actorId?: bigint) {
    const data: any = {};
    if (dto.titleEn != null) data.titleEn = dto.titleEn;
    if (dto.titleZh != null) data.titleZh = dto.titleZh;
    if (dto.imageUrl != null) data.imageUrl = dto.imageUrl;
    if ("linkUrl" in dto) data.linkUrl = this.normalizeBannerLinkUrl(dto.linkUrl);
    if ("dramaId" in dto) data.dramaId = await this.resolveBannerDramaId(dto.dramaId);
    if (dto.startAt != null) data.startAt = new Date(dto.startAt);
    if (dto.endAt != null) data.endAt = new Date(dto.endAt);
    if (dto.sortOrder != null) data.sortOrder = Number(dto.sortOrder);
    if (dto.isActive != null) data.isActive = !!dto.isActive;
    if (data.startAt && Number.isNaN(data.startAt.getTime())) {
      throw new BizException(BizCode.BAD_REQUEST, 'startAt không hợp lệ');
    }
    if (data.endAt && Number.isNaN(data.endAt.getTime())) {
      throw new BizException(BizCode.BAD_REQUEST, 'endAt không hợp lệ');
    }
    if (data.startAt || data.endAt) {
      const existing = await this.prisma.banner.findUnique({ where: { id: BigInt(id) } });
      if (!existing) throw new BizException(BizCode.NOT_FOUND, 'Banner không tồn tại');
      const start = data.startAt ?? existing.startAt;
      const end = data.endAt ?? existing.endAt;
      if (end <= start) {
        throw new BizException(BizCode.BAD_REQUEST, 'validation.endAfterStart');
      }
    }
    const banner = await this.prisma.banner.update({
      where: { id: BigInt(id) },
      data,
    });
    await this.audit.write({
      actorId,
      action: 'banner.update',
      targetType: 'banner',
      targetId: id,
      payload: data,
    });
    return { id: banner.id.toString() };
  }

  async deleteBanner(id: string, actorId?: bigint) {
    await this.prisma.banner.delete({ where: { id: BigInt(id) } });
    await this.audit.write({
      actorId,
      action: 'banner.delete',
      targetType: 'banner',
      targetId: id,
    });
    return { ok: true };
  }

  // ============ Category CRUD ============
  async listCategories(all = false) {
    const where = all ? undefined : { isActive: true };
    const rows = await this.prisma.category.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
    });
    return { rows, total: rows.length };
  }

  async createCategory(
    dto: { slug: string; nameEn: string; nameZh: string; sortOrder?: number; isActive?: boolean },
    actorId?: bigint,
  ) {
    const cat = await this.prisma.category.create({
      data: {
        slug: dto.slug,
        nameEn: dto.nameEn,
        nameZh: dto.nameZh,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
    await this.audit.write({
      actorId,
      action: 'category.create',
      targetType: 'category',
      targetId: cat.slug,
      payload: { nameEn: cat.nameEn },
    });
    return { slug: cat.slug };
  }

  async updateCategory(slug: string, dto: any, actorId?: bigint) {
    const data: any = {};
    if (dto.nameEn != null) data.nameEn = dto.nameEn;
    if (dto.nameZh != null) data.nameZh = dto.nameZh;
    if (dto.sortOrder != null) data.sortOrder = Number(dto.sortOrder);
    if (dto.isActive != null) data.isActive = !!dto.isActive;
    const cat = await this.prisma.category.update({
      where: { slug },
      data,
    });
    await this.audit.write({
      actorId,
      action: 'category.update',
      targetType: 'category',
      targetId: slug,
      payload: data,
    });
    return { slug: cat.slug };
  }

  async deleteCategory(slug: string, actorId?: bigint) {
    const cnt = await this.prisma.drama.count({ where: { categorySlug: slug } });
    if (cnt > 0) {
      throw new BizException(
        BizCode.CONFLICT,
        `Không thể xoá: có ${cnt} phim đang dùng danh mục này`,
      );
    }
    await this.prisma.category.delete({ where: { slug } });
    await this.audit.write({
      actorId,
      action: 'category.delete',
      targetType: 'category',
      targetId: slug,
    });
    return { ok: true };
  }

  // ============ Drama 管理动作 ============
  async updateDrama(id: string, dto: any, actorId?: bigint) {
    const data: any = {};
    if (dto.titleEn != null) data.titleEn = dto.titleEn;
    if (dto.titleZh != null) data.titleZh = dto.titleZh;
    if (dto.descriptionEn != null) data.descriptionEn = dto.descriptionEn;
    if (dto.descriptionZh != null) data.descriptionZh = dto.descriptionZh;
    if (dto.categorySlug != null) data.categorySlug = dto.categorySlug;
    if (dto.coverUrl != null) data.coverUrl = dto.coverUrl;
    if (dto.licenseType != null) data.licenseType = dto.licenseType;
    if (dto.sourcePublisher != null) data.sourcePublisher = String(dto.sourcePublisher).trim() || null;
    if (dto.attributionText != null) data.attributionText = String(dto.attributionText).trim() || null;
    if (dto.rightsProofUrl != null) data.rightsProofUrl = String(dto.rightsProofUrl).trim() || null;
    if (dto.rightsVerified != null) data.rightsVerifiedAt = dto.rightsVerified ? new Date() : null;
    if (dto.freeEpisodeCount != null) data.freeEpisodeCount = Number(dto.freeEpisodeCount);
    if (dto.lockMode !== undefined) {
      if (dto.lockMode === null || dto.lockMode === '' || dto.lockMode === 'INHERIT') {
        data.lockMode = null;
      } else if (
        dto.lockMode === 'FREE_FIRST_N' ||
        dto.lockMode === 'VIP_ALL' ||
        dto.lockMode === 'ALL_FREE'
      ) {
        data.lockMode = dto.lockMode;
      } else {
        throw new BizException(
          BizCode.BAD_REQUEST,
          'lockMode must be INHERIT | FREE_FIRST_N | VIP_ALL | ALL_FREE',
        );
      }
    }
    if (dto.buyoutCredits !== undefined) {
      if (dto.buyoutCredits === null || dto.buyoutCredits === '' || Number(dto.buyoutCredits) === 0) {
        data.buyoutCredits = null;
      } else {
        data.buyoutCredits = BigInt(String(dto.buyoutCredits));
      }
    }
    if (dto.sortWeight != null) data.sortWeight = Math.floor(Number(dto.sortWeight));
    if (dto.isFeatured != null) data.isFeatured = !!dto.isFeatured;
    if (dto.isOfficial != null) data.isOfficial = !!dto.isOfficial;
    if (dto.sourceTags !== undefined) {
      const existing = await this.prisma.drama.findUnique({
        where: { id: BigInt(id) },
        select: { tags: true },
      });
      if (!existing) {
        throw new BizException(BizCode.NOT_FOUND, 'common.recordNotFound');
      }
      data.tags = mergeDramaSourceTags(
        existing.tags,
        Array.isArray(dto.sourceTags) ? dto.sourceTags.map(String) : [],
      );
    }
    if (Object.keys(data).length === 0) {
      throw new BizException(BizCode.BAD_REQUEST, 'common.noFieldsToUpdate');
    }
    const drama = await this.prisma.drama.update({
      where: { id: BigInt(id) },
      data,
    });
    await this.audit.write({
      actorId,
      action: 'drama.update',
      targetType: 'drama',
      targetId: id,
      payload: data,
    });
    return { id: drama.id.toString() };
  }

  /** 强制下架（保留内容，置 status=OFFLINE） */
  async offlineDrama(id: string, reason?: string, actorId?: bigint) {
    if (!reason || !String(reason).trim()) {
      throw new BizException(BizCode.BAD_REQUEST, 'common.reasonRequired');
    }
    const drama = await this.prisma.drama.update({
      where: { id: BigInt(id) },
      data: { status: 'OFFLINE' },
    });
    await this.audit.write({
      actorId,
      action: 'drama.offline',
      targetType: 'drama',
      targetId: id,
      payload: { reason: String(reason).trim() },
    });
    return { id: drama.id.toString(), status: drama.status };
  }

  async onlineDrama(id: string, reason?: string, actorId?: bigint) {
    if (!reason || !String(reason).trim()) {
      throw new BizException(BizCode.BAD_REQUEST, 'common.reasonRequired');
    }
    await this.readiness.assertDramaReady(BigInt(id));
    const drama = await this.prisma.drama.update({
      where: { id: BigInt(id) },
      data: { status: 'LIVE', publishedAt: new Date() },
    });
    await this.audit.write({
      actorId,
      action: 'drama.online',
      targetType: 'drama',
      targetId: id,
      payload: { reason: String(reason).trim() },
    });
    return { id: drama.id.toString(), status: drama.status };
  }

  /**
   * 管理员创建在线剧集：填写外链/平台跳转链，转换为可播放地址后入库。
   */
  async createOnlineDrama(dto: CreateOnlineDramaInput, actorId?: bigint) {
    const titleZh = String(dto.titleZh || '').trim();
    if (!titleZh) {
      throw new BizException(BizCode.BAD_REQUEST, '中文标题必填');
    }
    const categorySlug = String(dto.categorySlug || '').trim();
    if (!categorySlug) {
      throw new BizException(BizCode.BAD_REQUEST, '分类必填');
    }
    const category = await this.prisma.category.findUnique({ where: { slug: categorySlug } });
    if (!category) {
      throw new BizException(BizCode.BAD_REQUEST, `分类不存在: ${categorySlug}`);
    }
    if (!Array.isArray(dto.episodes) || dto.episodes.length === 0) {
      throw new BizException(BizCode.BAD_REQUEST, '至少填写一集播放链接');
    }

    const titleEn = String(dto.titleEn || titleZh).trim();
    let slug = String(dto.slug || slugifyTitle(titleZh)).trim();
    if (!slug) slug = slugifyTitle(titleZh);
    // Explicit slug from operator still conflicts; auto-derived slugs get a unique suffix.
    if (dto.slug?.trim()) {
      const existing = await this.prisma.drama.findUnique({ where: { slug } });
      if (existing) {
        throw new BizException(BizCode.CONFLICT, `slug 已存在: ${slug}`);
      }
    } else {
      slug = await this.ensureUniqueSlug(slug);
    }

    const externalRef = dto.externalRef?.trim() || manualExternalRef(dto.episodes.map((e) => e.sourceUrl));
    {
      const byRef = await this.prisma.drama.findFirst({
        where: { externalRef } as any,
      });
      if (byRef) {
        throw new BizException(BizCode.CONFLICT, `externalRef 已存在: ${externalRef}`);
      }
    }

    const converted: Array<{
      episodeNumber: number;
      title: string | null;
      playUrl: string;
      originalUrl: string;
      isFree: boolean;
      sourcePageUrl: string | null;
      sourceProvider: string | null;
      externalVideoId: string | null;
      playlistIndex: number | null;
    }> = [];

    for (let i = 0; i < dto.episodes.length; i++) {
      const ep = dto.episodes[i];
      const episodeNumber = Number(ep.episodeNumber ?? i + 1);
      if (!Number.isFinite(episodeNumber) || episodeNumber < 1) {
        throw new BizException(BizCode.BAD_REQUEST, `第 ${i + 1} 集集号无效`);
      }
      try {
        const { playUrl, originalUrl } = convertExternalPlayUrl(ep.sourceUrl, {
          relaxed: !!dto.relaxedPlayUrl,
        });
        const sourcePageUrl = ep.sourcePageUrl?.trim() || originalUrl;
        const sourceProvider = ep.sourceProvider?.trim() || 'manual';
        const externalVideoId =
          ep.externalVideoId?.trim() || manualExternalVideoId(originalUrl);
        converted.push({
          episodeNumber,
          title: ep.title?.trim() || null,
          playUrl,
          originalUrl,
          isFree: ep.isFree !== false,
          sourcePageUrl,
          sourceProvider,
          externalVideoId,
          playlistIndex: ep.playlistIndex && ep.playlistIndex > 0 ? Math.floor(ep.playlistIndex) : null,
        });
      } catch (e: any) {
        throw new BizException(
          BizCode.BAD_REQUEST,
          `第 ${episodeNumber} 集: ${e?.message || '链接转换失败'}`,
        );
      }
    }

    const epNums = new Set(converted.map((e) => e.episodeNumber));
    if (epNums.size !== converted.length) {
      throw new BizException(BizCode.BAD_REQUEST, '集号不能重复');
    }

    let creator = await this.prisma.creator.findFirst({
      where: { kycStatus: 'APPROVED' },
      orderBy: { id: 'asc' },
    });
    if (!creator) {
      creator = await this.prisma.creator.findFirst();
    }
    if (!creator) {
      const u = await this.prisma.user.upsert({
        where: { email: 'sample@velvet.dev' },
        create: { email: 'sample@velvet.dev', nickname: 'Sample Studio' },
        update: {},
      });
      creator = await this.prisma.creator.create({
        data: {
          userId: u.id,
          creatorType: 'INDIVIDUAL',
          displayName: 'Sample Studio',
          revenueShare: await this.platformSettings.getRevenueShareDefault(),
          kycStatus: 'APPROVED',
        },
      });
    }

    const freeEpisodeCount = Math.max(0, Math.floor(Number(dto.freeEpisodeCount ?? converted.length)));
    const lockMode = dto.lockMode || 'ALL_FREE';
    // 外部资源必须先完成来源和权利审核，禁止创建时直接上线。
    const status = 'DRAFT' as const;

    const drama = await this.prisma.$transaction(async (tx) => {
      const created = await tx.drama.create({
        data: {
          creatorId: creator!.id,
          slug,
          titleEn,
          titleZh,
          descriptionEn: dto.descriptionEn?.trim() || null,
          descriptionZh: dto.descriptionZh?.trim() || null,
          categorySlug,
          coverUrl: dto.coverUrl?.trim() || null,
          freeEpisodeCount,
          lockMode,
          isOfficial: true,
          sourceType: 'ONLINE',
          externalRef,
          tags: Array.isArray(dto.sourceTags) && dto.sourceTags.length
            ? dto.sourceTags.map(String).filter(Boolean)
            : externalRef.startsWith('manual:')
              ? ['manual', 'online']
              : [],
          status,
          publishedAt: null,
          totalEpisodes: converted.length,
        } as any,
      });

      for (const ep of converted) {
        const isFree = lockMode === 'ALL_FREE' || ep.isFree || ep.episodeNumber <= freeEpisodeCount;
        await tx.episode.create({
          data: {
            dramaId: created.id,
            episodeNumber: ep.episodeNumber,
            title: ep.title || `第 ${ep.episodeNumber} 集`,
            isFree,
            priceCredits: isFree ? 0n : 10n,
            priceVnd: isFree ? 0n : 10000n,
            hlsUrl: ep.playUrl,
            originalUrl: ep.originalUrl,
            sourcePageUrl: ep.sourcePageUrl,
            sourceProvider: ep.sourceProvider,
            externalVideoId: ep.externalVideoId,
            playlistIndex: ep.playlistIndex,
            resolvedAt: new Date(),
            resolvedExpiresAt: inferExternalUrlExpiry(ep.playUrl),
            uploadStatus: 'COMPLETED',
            transcodeStatus: 'COMPLETED',
          },
        });
      }
      return created;
    });

    await this.audit.write({
      actorId,
      action: 'drama.createOnline',
      targetType: 'drama',
      targetId: drama.id.toString(),
      payload: {
        slug: drama.slug,
        episodeCount: converted.length,
        status,
        externalRef,
      },
    });

    return {
      id: drama.id.toString(),
      slug: drama.slug,
      status: drama.status,
      sourceType: drama.sourceType,
      externalRef: (drama as any).externalRef ?? externalRef,
      totalEpisodes: converted.length,
      episodes: converted.map((e) => ({
        episodeNumber: e.episodeNumber,
        playUrl: e.playUrl,
        originalUrl: e.originalUrl,
      })),
    };
  }

  /**
   * 创建本地托管剧壳（无分集）。随后用 /admin/dramas/:id/episodes/upload 逐集上传，
   * 转码完成后按 STORAGE_BACKEND=r2 推送到 velvet-media。
   */
  async createLocalUploadDrama(dto: CreateLocalUploadDramaInput, actorId?: bigint) {
    const titleZh = String(dto.titleZh || '').trim();
    if (!titleZh) {
      throw new BizException(BizCode.BAD_REQUEST, '中文标题必填');
    }
    const categorySlug = String(dto.categorySlug || '').trim();
    if (!categorySlug) {
      throw new BizException(BizCode.BAD_REQUEST, '分类必填');
    }
    const cat = await this.prisma.category.findUnique({ where: { slug: categorySlug } });
    if (!cat) {
      throw new BizException(BizCode.BAD_REQUEST, `分类不存在: ${categorySlug}`);
    }

    const titleEn = String(dto.titleEn || titleZh).trim();
    let slug = String(dto.slug || slugifyTitle(titleZh)).trim();
    if (!slug) slug = slugifyTitle(titleZh);
    if (dto.slug?.trim()) {
      const existing = await this.prisma.drama.findUnique({ where: { slug } });
      if (existing) {
        throw new BizException(BizCode.CONFLICT, `slug 已存在: ${slug}`);
      }
    } else {
      slug = await this.ensureUniqueSlug(slug);
    }

    const externalRef = dto.externalRef?.trim() || null;
    if (externalRef) {
      const byRef = await this.prisma.drama.findFirst({
        where: { externalRef } as any,
      });
      if (byRef) {
        throw new BizException(BizCode.CONFLICT, `externalRef 已存在: ${externalRef}`);
      }
    }

    let creator = await this.prisma.creator.findFirst({
      where: { kycStatus: 'APPROVED' },
      orderBy: { id: 'asc' },
    });
    if (!creator) {
      creator = await this.prisma.creator.findFirst();
    }
    if (!creator) {
      const u = await this.prisma.user.upsert({
        where: { email: 'sample@velvet.dev' },
        create: { email: 'sample@velvet.dev', nickname: 'Sample Studio' },
        update: {},
      });
      creator = await this.prisma.creator.create({
        data: {
          userId: u.id,
          creatorType: 'INDIVIDUAL',
          displayName: 'Sample Studio',
          revenueShare: await this.platformSettings.getRevenueShareDefault(),
          kycStatus: 'APPROVED',
        },
      });
    }

    const freeEpisodeCount = Math.max(0, Math.floor(Number(dto.freeEpisodeCount ?? 3)));
    const lockMode = dto.lockMode || 'FREE_FIRST_N';
    // 创建时一律草稿；转码完成后再经 assertDramaReady 恢复上架，禁止绕过就绪门禁。
    const status = 'DRAFT' as const;
    const announcedTotal = Math.max(0, Math.floor(Number(dto.totalEpisodes ?? 0)));
    const sourceType = dto.sourceType === 'LOCAL' ? 'LOCAL' : 'R2';
    const baseTags = sourceType === 'LOCAL' ? ['upload', 'local'] : ['upload', 'r2'];
    const extraTags = (dto.sourceTags || []).map(String).filter(Boolean);
    const tags = [...baseTags, ...extraTags.filter((t) => !baseTags.includes(t))];

    const drama = await this.prisma.drama.create({
      data: {
        creatorId: creator.id,
        slug,
        titleEn,
        titleZh,
        descriptionEn: dto.descriptionEn?.trim() || null,
        descriptionZh: dto.descriptionZh?.trim() || null,
        categorySlug,
        coverUrl: dto.coverUrl?.trim() || null,
        freeEpisodeCount,
        lockMode,
        isOfficial: true,
        sourceType,
        externalRef,
        tags,
        status,
        publishedAt: null,
        totalEpisodes: announcedTotal,
      } as any,
    });

    await this.audit.write({
      actorId,
      action: 'drama.createUpload',
      targetType: 'drama',
      targetId: drama.id.toString(),
      payload: {
        slug: drama.slug,
        status,
        totalEpisodes: announcedTotal,
        storageBackend: this.config.get('STORAGE_BACKEND') || 'local',
      },
    });

    return {
      id: drama.id.toString(),
      slug: drama.slug,
      status: drama.status,
      sourceType: drama.sourceType,
      totalEpisodes: announcedTotal,
      storageBackend: (this.config.get<string>('STORAGE_BACKEND') || 'local').toLowerCase(),
      r2Enabled: (this.config.get<string>('STORAGE_BACKEND') || 'local').toLowerCase() === 'r2',
    };
  }

  /** 软删除：清空关联、保留订单收益记录；同步清理本地与 R2 媒资 */
  async deleteDrama(id: string, reason?: string, actorId?: bigint) {
    const dramaId = BigInt(id);
    const cnt = await this.prisma.order.count({ where: { dramaId } });
    if (cnt > 0) {
      throw new BizException(
        BizCode.CONFLICT,
        `Không thể xoá: có ${cnt} đơn hàng liên quan. Hãy OFFLINE thay vì xoá.`,
      );
    }
    const drama = await this.prisma.drama.findUnique({
      where: { id: dramaId },
      include: {
        episodes: {
          select: { hlsUrl: true, originalUrl: true, thumbnailUrl: true },
        },
      },
    });
    if (!drama) throw new BizException(BizCode.NOT_FOUND, 'drama.notFound');

    const urls: Array<string | null | undefined> = [drama.coverUrl];
    for (const ep of drama.episodes) {
      urls.push(ep.hlsUrl, ep.originalUrl, ep.thumbnailUrl);
    }
    const purge = await this.upload.purgeMediaUrls(urls);

    await this.prisma.$transaction(async (tx) => {
      await tx.episode.deleteMany({ where: { dramaId } });
      await tx.drama.delete({ where: { id: dramaId } });
    });
    await this.audit.write({
      actorId,
      action: 'drama.delete',
      targetType: 'drama',
      targetId: id,
      payload: { reason, purge },
    });
    return { ok: true, purge };
  }

  /**
   * Batch shelf / delete. Offline & online use updateMany; delete runs per-id
   * so order conflicts and media purge stay consistent with single delete.
   */
  async batchLifecycle(
    action: 'offline' | 'online' | 'delete',
    ids: (string | number)[],
    reason?: string,
    actorId?: bigint,
  ) {
    if (!ids?.length) throw new BizException(BizCode.BAD_REQUEST, 'ids.empty');
    const reasonText = (reason && String(reason).trim()) || `admin batch ${action}`;
    const uniqueIds = [...new Set(ids.map((id) => String(id)))];
    const bigIds = uniqueIds.map((id) => BigInt(id));

    if (action === 'offline') {
      const result = await this.prisma.drama.updateMany({
        where: { id: { in: bigIds }, status: 'LIVE' },
        data: { status: 'OFFLINE' },
      });
      const updated = result.count;
      const skipped = Math.max(0, uniqueIds.length - updated);
      await this.audit.write({
        actorId,
        action: 'drama.batchOffline',
        targetType: 'drama',
        payload: { ids: uniqueIds, reason: reasonText, requested: uniqueIds.length, updated, skipped },
      });
      return {
        action,
        requested: uniqueIds.length,
        updated,
        skipped,
        failed: [] as { id: string; error: string }[],
      };
    }

    if (action === 'online') {
      const result = await this.prisma.drama.updateMany({
        where: { id: { in: bigIds }, status: { in: ['OFFLINE', 'REJECTED'] } },
        data: { status: 'LIVE', publishedAt: new Date() },
      });
      const updated = result.count;
      const skipped = Math.max(0, uniqueIds.length - updated);
      await this.audit.write({
        actorId,
        action: 'drama.batchOnline',
        targetType: 'drama',
        payload: { ids: uniqueIds, reason: reasonText, requested: uniqueIds.length, updated, skipped },
      });
      return {
        action,
        requested: uniqueIds.length,
        updated,
        skipped,
        failed: [] as { id: string; error: string }[],
      };
    }

    const failed: { id: string; error: string }[] = [];
    let updated = 0;
    for (const id of uniqueIds) {
      try {
        await this.deleteDrama(id, reasonText, actorId);
        updated += 1;
      } catch (e: any) {
        failed.push({
          id,
          error: e?.message || String(e),
        });
      }
    }
    const skipped = Math.max(0, uniqueIds.length - updated - failed.length);
    await this.audit.write({
      actorId,
      action: 'drama.batchDelete',
      targetType: 'drama',
      payload: { ids: uniqueIds, reason: reasonText, requested: uniqueIds.length, updated, skipped, failed },
    });
    return {
      action,
      requested: uniqueIds.length,
      updated,
      skipped,
      failed,
    };
  }

  /** Auto-derived titles often collide; bump suffix until free. Explicit operator slugs still conflict. */
  private async ensureUniqueSlug(base: string): Promise<string> {
    const root = (base || 'drama').slice(0, 48);
    let slug = root;
    for (let n = 0; n < 50; n++) {
      const hit = await this.prisma.drama.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (!hit) return slug;
      slug = `${root.slice(0, 44)}-${n + 1}`;
    }
    return `${root.slice(0, 40)}-${Date.now().toString(36)}`;
  }
}

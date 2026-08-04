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
import { AuditService } from '../common/audit.service';

export interface LocalImportOptions {
  rootPath?: string;
  dryRun?: boolean;
  /** 写入 DB 的媒体相对路径前缀（相对 STORAGE_ROOT），如 `imports/{batchId}` */
  mediaPrefix?: string;
}

export interface LocalImportItemResult {
  folder: string;
  slug: string;
  titleZh: string;
  action: 'imported' | 'skipped' | 'would_import' | 'error';
  reason?: string;
  episodes?: number;
  dramaId?: string;
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  private readonly pitRate: number;
  private readonly defaultImportRoot: string;
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {
    this.pitRate = Number(config.get('PIT_RATE') || 0.05);
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
    if (!existing) throw new BizException(BizCode.NOT_FOUND, 'Không tìm thấy phim');
    if (existing.status !== 'PENDING_REVIEW') {
      throw new BizException(BizCode.CONFLICT, 'Yêu cầu đã được xử lý');
    }
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
    if (!existing) throw new BizException(BizCode.NOT_FOUND, 'Không tìm thấy phim');
    if (existing.status !== 'PENDING_REVIEW') {
      throw new BizException(BizCode.CONFLICT, 'Yêu cầu đã được xử lý');
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
    if (!existing) throw new BizException(BizCode.NOT_FOUND, 'Không tìm thấy creator');
    if (existing.kycStatus !== 'PENDING') {
      throw new BizException(BizCode.CONFLICT, 'KYC đã được xử lý');
    }
    const c = await this.prisma.creator.update({
      where: { id: BigInt(creatorId) },
      data: { kycStatus: 'APPROVED', kycRejectReason: null },
    });
    await this.audit.write({
      actorId,
      action: 'kyc.approve',
      targetType: 'creator',
      targetId: c.id,
      payload: { from: existing.kycStatus, to: c.kycStatus },
    });
    await this.notifyCreator(c.userId, 'kyc.approved', {
      titleVi: 'KYC đã được duyệt',
      titleZh: 'KYC 已通过',
      bodyVi: 'Bạn có thể tạo và đăng phim ngay bây giờ.',
      bodyZh: '您现在可以创建并发布短剧了。',
    });
    return { creatorId: c.id.toString(), kycStatus: c.kycStatus };
  }

  async rejectKyc(creatorId: string, reason?: string, actorId?: bigint | null) {
    if (!reason || !String(reason).trim()) {
      throw new BizException(BizCode.BAD_REQUEST, 'Lý do từ chối là bắt buộc');
    }
    const existing = await this.prisma.creator.findUnique({ where: { id: BigInt(creatorId) } });
    if (!existing) throw new BizException(BizCode.NOT_FOUND, 'Không tìm thấy creator');
    if (existing.kycStatus !== 'PENDING') {
      throw new BizException(BizCode.CONFLICT, 'KYC đã được xử lý');
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
      titleVi: 'KYC bị từ chối',
      titleZh: 'KYC 被拒绝',
      bodyVi: `Lý do: ${reason}`,
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
      titleVi: string;
      titleZh?: string;
      bodyVi?: string;
      bodyZh?: string;
    },
  ) {
    try {
      await this.prisma.notification.create({
        data: {
          userId,
          type,
          titleVi: content.titleVi,
          titleZh: content.titleZh ?? null,
          bodyVi: content.bodyVi ?? null,
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
    if (!req) throw new BizException(BizCode.NOT_FOUND, 'Yêu cầu không tồn tại');
    if (req.status !== 'PENDING') {
      throw new BizException(BizCode.CONFLICT, 'Yêu cầu đã được xử lý');
    }
    const pitVnd = toBigInt(Math.floor(Number(req.amountVnd) * this.pitRate));
    const netVnd = req.amountVnd - pitVnd;

    const result = await this.prisma.$transaction(async (tx) => {
      // 申请时已从 availableVnd 冻结；审核通过只记 withdrawn
      const updated = await tx.withdrawRequest.update({
        where: { id: req.id },
        data: { status: 'PAID', paidAt: new Date(), pitRate: this.pitRate, pitVnd, netVnd },
      });
      await tx.creatorEarning.update({
        where: { creatorId: req.creatorId },
        data: { withdrawnVnd: { increment: req.amountVnd } },
      });
      return updated;
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
      throw new BizException(BizCode.BAD_REQUEST, 'Lý do từ chối là bắt buộc');
    }
    const req = await this.prisma.withdrawRequest.findUnique({ where: { id: BigInt(id) } });
    if (!req) throw new BizException(BizCode.NOT_FOUND, 'Yêu cầu không tồn tại');
    if (req.status !== 'PENDING') {
      throw new BizException(BizCode.CONFLICT, 'Yêu cầu đã được xử lý');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.withdrawRequest.update({
        where: { id: req.id },
        data: { status: 'REJECTED', rejectReason: String(reason).trim() },
      });
      // 归还申请时冻结的 available
      await tx.creatorEarning.update({
        where: { creatorId: req.creatorId },
        data: { availableVnd: { increment: req.amountVnd } },
      });
      return updated;
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
    if (!order) throw new BizException(BizCode.NOT_FOUND, 'Đơn hàng không tồn tại');
    if (order.paymentStatus === 'REFUNDED') {
      throw new BizException(
        BizCode.CONFLICT,
        'Đơn hàng đã hoàn tiền, không thể đánh dấu PAID',
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
   * 管理员本地目录批量导入：扫描 rootPath 下每个子文件夹为一剧，
   * 按 slug / titleZh / 归一化文件夹名去重；幂等，已存在则 skip。
   */
  async importLocal(opts: LocalImportOptions = {}) {
    const rootPath = path.resolve(opts.rootPath || this.defaultImportRoot);
    const dryRun = !!opts.dryRun;
    const mediaPrefix = (opts.mediaPrefix || '').replace(/^\/+|\/+$/g, '');

    if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
      throw new BizException(BizCode.BAD_REQUEST, `导入目录不存在: ${rootPath}`);
    }

    for (const c of IMPORT_CATEGORIES) {
      await this.prisma.category.upsert({
        where: { slug: c.slug },
        create: c,
        update: { nameVi: c.nameVi, nameZh: c.nameZh },
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
          revenueShare: 0.7,
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
            titleVi: def.titleVi,
            titleZh: def.titleZh,
            descriptionVi: def.descVi || null,
            descriptionZh: def.descZh || null,
            categorySlug: def.category,
            coverUrl: coverUrl || null,
            freeEpisodeCount: def.freeCount,
            isOfficial: !!def.isOfficial,
            isFeatured: !!def.isFeatured,
            status: 'LIVE',
            publishedAt: new Date(),
            totalEpisodes: videos.length,
            viewCount: BigInt(Math.floor(Math.random() * 5000) + 500),
            unlockCount: BigInt(Math.floor(Math.random() * 500) + 50),
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
              title: `Tập ${ep}`,
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
      titleVi: string;
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
      throw new BizException(BizCode.BAD_REQUEST, 'endAt phải sau startAt');
    }
    const banner = await this.prisma.banner.create({
      data: {
        titleVi: dto.titleVi,
        titleZh: dto.titleZh,
        imageUrl: dto.imageUrl,
        linkUrl: dto.linkUrl,
        dramaId: dto.dramaId ? BigInt(dto.dramaId) : null,
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
      payload: { titleVi: banner.titleVi },
    });
    return { id: banner.id.toString() };
  }

  async updateBanner(id: string, dto: any, actorId?: bigint) {
    const data: any = {};
    if (dto.titleVi != null) data.titleVi = dto.titleVi;
    if (dto.titleZh != null) data.titleZh = dto.titleZh;
    if (dto.imageUrl != null) data.imageUrl = dto.imageUrl;
    if (dto.linkUrl != null) data.linkUrl = dto.linkUrl;
    if (dto.dramaId != null) data.dramaId = BigInt(dto.dramaId);
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
        throw new BizException(BizCode.BAD_REQUEST, 'endAt phải sau startAt');
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
    dto: { slug: string; nameVi: string; nameZh: string; sortOrder?: number; isActive?: boolean },
    actorId?: bigint,
  ) {
    const cat = await this.prisma.category.create({
      data: {
        slug: dto.slug,
        nameVi: dto.nameVi,
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
      payload: { nameVi: cat.nameVi },
    });
    return { slug: cat.slug };
  }

  async updateCategory(slug: string, dto: any, actorId?: bigint) {
    const data: any = {};
    if (dto.nameVi != null) data.nameVi = dto.nameVi;
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
    if (dto.titleVi != null) data.titleVi = dto.titleVi;
    if (dto.titleZh != null) data.titleZh = dto.titleZh;
    if (dto.descriptionVi != null) data.descriptionVi = dto.descriptionVi;
    if (dto.descriptionZh != null) data.descriptionZh = dto.descriptionZh;
    if (dto.categorySlug != null) data.categorySlug = dto.categorySlug;
    if (dto.coverUrl != null) data.coverUrl = dto.coverUrl;
    if (dto.freeEpisodeCount != null) data.freeEpisodeCount = Number(dto.freeEpisodeCount);
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
    if (Object.keys(data).length === 0) {
      throw new BizException(BizCode.BAD_REQUEST, 'Không có trường nào để cập nhật');
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
      throw new BizException(BizCode.BAD_REQUEST, 'Lý do là bắt buộc');
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
      throw new BizException(BizCode.BAD_REQUEST, 'Lý do là bắt buộc');
    }
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

  /** 软删除：清空关联、保留订单收益记录 */
  async deleteDrama(id: string, reason?: string, actorId?: bigint) {
    const dramaId = BigInt(id);
    const cnt = await this.prisma.order.count({ where: { dramaId } });
    if (cnt > 0) {
      throw new BizException(
        BizCode.CONFLICT,
        `Không thể xoá: có ${cnt} đơn hàng liên quan. Hãy OFFLINE thay vì xoá.`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.episode.deleteMany({ where: { dramaId } });
      await tx.drama.delete({ where: { id: dramaId } });
    });
    await this.audit.write({
      actorId,
      action: 'drama.delete',
      targetType: 'drama',
      targetId: id,
      payload: { reason },
    });
    return { ok: true };
  }
}

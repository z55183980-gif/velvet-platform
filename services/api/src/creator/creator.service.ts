import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import { toBigInt, genOrderNo } from '../common/money.util';
import { withPrismaGuard } from '../common/prisma-error.util';
import { ContentReadinessService } from '../common/content-readiness.service';
import { PlatformSettingsService } from '../common/platform-settings.service';

@Injectable()
export class CreatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly readiness: ContentReadinessService,
    private readonly platformSettings: PlatformSettingsService,
  ) {}

  /** 确保当前用户有 creator 记录（首次进入创作者中心时自动建） */
  async ensureCreator(userId: bigint) {
    const existing = await this.prisma.creator.findUnique({ where: { userId } });
    if (existing) return existing;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const revenueShare = await this.platformSettings.getRevenueShareDefault();
    try {
      return await this.prisma.creator.create({
        data: {
          userId,
          displayName: user?.nickname || user?.phone || `Creator ${userId}`,
          revenueShare,
        },
      });
    } catch (e: any) {
      // 并发首次进入：另一请求已创建 → 再读
      if (e?.code === 'P2002') {
        const again = await this.prisma.creator.findUnique({ where: { userId } });
        if (again) return again;
      }
      throw e;
    }
  }

  /** 确认开通创作者账号（幂等） */
  async activateCreator(userId: bigint) {
    const creator = await this.ensureCreator(userId);
    return {
      id: creator.id.toString(),
      displayName: creator.displayName,
      isCreator: true,
      kycStatus: creator.kycStatus,
      status: creator.status,
    };
  }

  /** 查询是否已开通；不自动建号 */
  async getCreatorStatus(userId: bigint) {
    const creator = await this.prisma.creator.findUnique({ where: { userId } });
    if (!creator) {
      return { isCreator: false, status: null, kycStatus: null, displayName: null };
    }
    return {
      isCreator: true,
      status: creator.status,
      kycStatus: creator.kycStatus,
      displayName: creator.displayName,
    };
  }

  async getDashboard(userId: bigint) {
    const creator = await this.ensureCreator(userId);
    const [dramaCnt, episodeCnt, earning, monthIncome] = await Promise.all([
      this.prisma.drama.count({ where: { creatorId: creator.id } }),
      this.prisma.episode.count({ where: { drama: { creatorId: creator.id } } }),
      this.prisma.creatorEarning.findUnique({ where: { creatorId: creator.id } }),
      this.prisma.order.aggregate({
        where: {
          creatorId: creator.id,
          paymentStatus: 'PAID',
          paidAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
        _sum: { creatorIncomeVnd: true },
      }),
    ]);
    return {
      creatorId: creator.id.toString(),
      kycStatus: creator.kycStatus,
      dramas: dramaCnt,
      episodes: episodeCnt,
      availableVnd: (earning?.availableVnd ?? 0n).toString(),
      pendingVnd: (earning?.pendingVnd ?? 0n).toString(),
      withdrawnVnd: (earning?.withdrawnVnd ?? 0n).toString(),
      totalEarnedVnd: (earning?.totalEarnedVnd ?? 0n).toString(),
      monthEarningVnd: (monthIncome._sum.creatorIncomeVnd ?? 0n).toString(),
    };
  }

  async getEarnings(userId: bigint, page = 1, pageSize = 20) {
    const creator = await this.ensureCreator(userId);
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where: { creatorId: creator.id, paymentStatus: 'PAID' },
        orderBy: { paidAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          orderNo: true,
          creatorIncomeVnd: true,
          amountVnd: true,
          paidAt: true,
          episodeId: true,
        },
      }),
      this.prisma.order.count({ where: { creatorId: creator.id, paymentStatus: 'PAID' } }),
    ]);
    return { rows, total, page, pageSize };
  }

  /** 按日聚合；支持 from/to（YYYY-MM-DD）或 days */
  async getDailyEarnings(
    userId: bigint,
    opts: { from?: string; to?: string; days?: number } = {},
  ) {
    const creator = await this.ensureCreator(userId);
    let since: Date;
    let until: Date;
    if (opts.from || opts.to) {
      since = opts.from ? new Date(`${opts.from}T00:00:00.000Z`) : new Date(0);
      until = opts.to ? new Date(`${opts.to}T23:59:59.999Z`) : new Date();
      if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
        throw new BizException(BizCode.BAD_REQUEST, 'from/to không hợp lệ');
      }
    } else {
      const days = Math.min(180, Math.max(1, opts.days || 30));
      since = new Date();
      since.setUTCDate(since.getUTCDate() - days + 1);
      since.setUTCHours(0, 0, 0, 0);
      until = new Date();
    }

    const rows = await this.prisma.$queryRaw<Array<{ day: Date; total: bigint; cnt: bigint }>>`
      SELECT date_trunc('day', "paidAt") AS day,
             SUM("creatorIncomeVnd")::bigint AS total,
             COUNT(*)::bigint AS cnt
        FROM orders
       WHERE "creatorId" = ${creator.id}
         AND "paymentStatus" = 'PAID'
         AND "paidAt" >= ${since}
         AND "paidAt" <= ${until}
    GROUP BY day
    ORDER BY day ASC
    `;

    const map = new Map<string, { total: string; orders: number }>();
    rows.forEach((r) => {
      const k = r.day.toISOString().slice(0, 10);
      map.set(k, { total: r.total.toString(), orders: Number(r.cnt) });
    });

    const out: { day: string; totalVnd: string; orders: number }[] = [];
    const cursor = new Date(since);
    cursor.setUTCHours(0, 0, 0, 0);
    const endDay = new Date(until);
    endDay.setUTCHours(0, 0, 0, 0);
    while (cursor <= endDay) {
      const k = cursor.toISOString().slice(0, 10);
      const r = map.get(k);
      out.push({
        day: k,
        totalVnd: r?.total ?? '0',
        orders: r?.orders ?? 0,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return {
      rows: out,
      from: since.toISOString().slice(0, 10),
      to: until.toISOString().slice(0, 10),
      days: out.length,
    };
  }

  /** 订单明细（按 paidAt 区间） */
  async getEarningsOrders(
    userId: bigint,
    opts: { from?: string; to?: string; page?: number; pageSize?: number } = {},
  ) {
    const creator = await this.ensureCreator(userId);
    const page = Math.max(1, opts.page || 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize || 20));
    const where: any = { creatorId: creator.id, paymentStatus: 'PAID' };
    if (opts.from || opts.to) {
      where.paidAt = {};
      if (opts.from) where.paidAt.gte = new Date(`${opts.from}T00:00:00.000Z`);
      if (opts.to) where.paidAt.lte = new Date(`${opts.to}T23:59:59.999Z`);
    }
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { paidAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          orderNo: true,
          creatorIncomeVnd: true,
          amountVnd: true,
          paidAt: true,
          episodeId: true,
          dramaId: true,
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    return {
      rows: rows.map((r) => ({
        ...r,
        creatorIncomeVnd: r.creatorIncomeVnd.toString(),
        amountVnd: r.amountVnd.toString(),
        episodeId: r.episodeId?.toString() ?? null,
        dramaId: r.dramaId?.toString() ?? null,
      })),
      total,
      page,
      pageSize,
    };
  }

  async updateDrama(userId: bigint, dramaId: string, dto: any) {
    const creator = await this.ensureCreator(userId);
    const drama = await this.prisma.drama.findUnique({ where: { id: BigInt(dramaId) } });
    if (!drama || drama.creatorId !== creator.id) {
      throw new BizException(BizCode.NOT_FOUND, 'drama.notFound');
    }
    const data: any = {};
    if (dto.titleEn != null) data.titleEn = String(dto.titleEn).trim();
    if (dto.titleZh != null) data.titleZh = String(dto.titleZh).trim();
    if (dto.titleFr != null) data.titleFr = String(dto.titleFr).trim() || null;
    if (dto.descriptionEn != null) data.descriptionEn = dto.descriptionEn;
    if (dto.descriptionZh != null) data.descriptionZh = dto.descriptionZh;
    if (dto.coverUrl != null) data.coverUrl = dto.coverUrl;
    if (dto.freeEpisodeCount != null) data.freeEpisodeCount = Number(dto.freeEpisodeCount);
    if (Object.keys(data).length === 0) {
      throw new BizException(BizCode.BAD_REQUEST, 'common.noFieldsToUpdate');
    }
    const updated = await this.prisma.drama.update({
      where: { id: drama.id },
      data,
    });
    return { id: updated.id.toString(), status: updated.status };
  }

  /** 仅 DRAFT 可删 */
  async deleteDrama(userId: bigint, dramaId: string) {
    const creator = await this.ensureCreator(userId);
    const drama = await this.prisma.drama.findUnique({ where: { id: BigInt(dramaId) } });
    if (!drama || drama.creatorId !== creator.id) {
      throw new BizException(BizCode.NOT_FOUND, 'drama.notFound');
    }
    if (drama.status !== 'DRAFT') {
      throw new BizException(BizCode.CONFLICT, 'Chỉ xoá được phim ở trạng thái DRAFT');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.like.deleteMany({ where: { dramaId: drama.id } });
      await tx.favorite.deleteMany({ where: { dramaId: drama.id } });
      await tx.userDramaUnlock.deleteMany({ where: { dramaId: drama.id } });
      await tx.userUnlock.deleteMany({
        where: { episode: { dramaId: drama.id } },
      });
      await tx.episode.deleteMany({ where: { dramaId: drama.id } });
      await tx.drama.delete({ where: { id: drama.id } });
    });
    return { ok: true };
  }

  /** 创作者自助下架 LIVE → OFFLINE */
  async offlineDrama(userId: bigint, dramaId: string) {
    const creator = await this.ensureCreator(userId);
    const drama = await this.prisma.drama.findUnique({ where: { id: BigInt(dramaId) } });
    if (!drama || drama.creatorId !== creator.id) {
      throw new BizException(BizCode.NOT_FOUND, 'drama.notFound');
    }
    if (drama.status !== 'LIVE') {
      throw new BizException(BizCode.CONFLICT, 'Chỉ có thể gỡ phim đang LIVE');
    }
    const updated = await this.prisma.drama.update({
      where: { id: drama.id },
      data: { status: 'OFFLINE' },
    });
    return { id: updated.id.toString(), status: updated.status };
  }

  /** 仅所属 DRAFT 剧的剧集可删 */
  async deleteEpisode(userId: bigint, episodeId: string) {
    const creator = await this.ensureCreator(userId);
    const ep = await this.prisma.episode.findUnique({
      where: { id: BigInt(episodeId) },
      include: { drama: true },
    });
    if (!ep || ep.drama.creatorId !== creator.id) {
      throw new BizException(BizCode.NOT_FOUND, 'episode.notFound');
    }
    if (ep.drama.status !== 'DRAFT' && ep.drama.status !== 'REJECTED') {
      throw new BizException(BizCode.CONFLICT, 'Chỉ xoá được tập của phim DRAFT/REJECTED');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.episode.delete({ where: { id: ep.id } });
      const totalEpisodes = await tx.episode.count({ where: { dramaId: ep.dramaId } });
      await tx.drama.update({
        where: { id: ep.dramaId },
        data: { totalEpisodes, status: 'DRAFT' },
      });
    });
    return { ok: true };
  }

  async listWithdraws(userId: bigint, page = 1, pageSize = 20) {
    const creator = await this.ensureCreator(userId);
    const [rows, total] = await Promise.all([
      this.prisma.withdrawRequest.findMany({
        where: { creatorId: creator.id },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.withdrawRequest.count({ where: { creatorId: creator.id } }),
    ]);
    return { rows, total, page, pageSize };
  }

  async createWithdraw(userId: bigint, amountVnd: number | string, bankInfo: any) {
    const creator = await this.ensureCreator(userId);
    if (creator.kycStatus !== 'APPROVED') {
      throw new BizException(BizCode.FORBIDDEN, 'creator.kycRequiredForWithdraw');
    }
    if (!creator.bankAccount) {
      throw new BizException(BizCode.BAD_REQUEST, 'creator.bankAccountRequired');
    }
    const amount = toBigInt(amountVnd);
    if (amount <= 0n) throw new BizException(BizCode.BAD_REQUEST, 'Số tiền không hợp lệ');
    const minWithdraw = BigInt(await this.platformSettings.getMinWithdrawVnd());
    if (amount < minWithdraw) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        `creator.withdrawBelowMin:${minWithdraw.toString()}`,
      );
    }

    // 条件扣减：并发超额提现时只有一笔成功
    const req = await this.prisma.$transaction(async (tx) => {
      const frozen = await tx.creatorEarning.updateMany({
        where: { creatorId: creator.id, availableVnd: { gte: amount } },
        data: { availableVnd: { decrement: amount } },
      });
      if (frozen.count !== 1) {
        throw new BizException(BizCode.INSUFFICIENT_BALANCE, 'Số dư chưa đủ để rút');
      }
      return tx.withdrawRequest.create({
        data: {
          requestNo: genOrderNo('WD'),
          creatorId: creator.id,
          amountVnd: amount,
          bankInfo: bankInfo || creator.bankAccount || {},
        },
      });
    });
    return { requestNo: req.requestNo, amountVnd: amount.toString(), status: req.status };
  }

  async listMyDramas(userId: bigint) {
    const creator = await this.ensureCreator(userId);
    return this.prisma.drama.findMany({
      where: { creatorId: creator.id },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { episodes: true } },
        episodes: {
          orderBy: { episodeNumber: 'asc' },
          select: {
            id: true,
            episodeNumber: true,
            title: true,
            hlsUrl: true,
            originalUrl: true,
            transcodeStatus: true,
            uploadStatus: true,
            isFree: true,
            priceCredits: true,
          },
        },
      },
    });
  }

  async createDrama(userId: bigint, dto: any) {
    return withPrismaGuard(async () => {
      const creator = await this.ensureCreator(userId);
      if (!dto?.titleEn || !String(dto.titleEn).trim()) {
        throw new BizException(BizCode.BAD_REQUEST, '缺少必要字段 titleEn');
      }
      if (!dto?.categorySlug || !String(dto.categorySlug).trim()) {
        throw new BizException(BizCode.BAD_REQUEST, '缺少必要字段 categorySlug');
      }
      const drama = await this.prisma.drama.create({
        data: {
          creatorId: creator.id,
          slug: `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          titleEn: String(dto.titleEn).trim(),
          titleZh: dto.titleZh,
          titleFr: dto.titleFr != null ? String(dto.titleFr).trim() || null : null,
          descriptionEn: dto.descriptionEn,
          descriptionZh: dto.descriptionZh,
          categorySlug: dto.categorySlug,
          coverUrl: dto.coverUrl,
          freeEpisodeCount: dto.freeEpisodeCount ?? 3,
          // lockMode null = inherit global episodeLockMode
          status: 'DRAFT',
        },
      });
      return { id: drama.id.toString(), status: drama.status };
    });
  }

  async submitReview(userId: bigint, dramaId: string) {
    const creator = await this.ensureCreator(userId);
    const drama = await this.prisma.drama.findUnique({ where: { id: BigInt(dramaId) } });
    if (!drama || drama.creatorId !== creator.id) {
      throw new BizException(BizCode.NOT_FOUND, 'drama.notFound');
    }
    if (drama.status !== 'DRAFT' && drama.status !== 'REJECTED') {
      throw new BizException(
        BizCode.CONFLICT,
        'Trạng thái hiện tại không cho phép gửi duyệt',
      );
    }
    await this.readiness.assertDramaReady(drama.id);
    const updated = await this.prisma.drama.update({
      where: { id: BigInt(dramaId) },
      data: { status: 'PENDING_REVIEW' },
    });
    return { id: updated.id.toString(), status: updated.status };
  }

  async createEpisode(userId: bigint, dto: any) {
    return withPrismaGuard(async () => {
      const creator = await this.ensureCreator(userId);
      const drama = await this.prisma.drama.findUnique({ where: { id: BigInt(dto.dramaId) } });
      if (!drama || drama.creatorId !== creator.id) {
        throw new BizException(BizCode.NOT_FOUND, 'drama.notFound');
      }
      if (drama.status !== 'DRAFT' && drama.status !== 'REJECTED') {
        throw new BizException(
          BizCode.CONFLICT,
          '审核中或已上线的作品不能追加剧集；请先撤回或下架后修改',
        );
      }
      if (dto.episodeNumber == null || Number(dto.episodeNumber) < 1) {
        throw new BizException(BizCode.BAD_REQUEST, 'episodeNumber không hợp lệ');
      }

      const isFree = !!dto.isFree;
      const priceCreditsNum =
        dto.priceCredits != null
          ? Number(dto.priceCredits)
          : dto.priceVnd != null
            ? Number(dto.priceVnd)
            : 0;
      // Keep priceVnd in sync with charged credits (legacy column name).
      const priceVndNum =
        dto.priceVnd != null && Number(dto.priceVnd) > 0
          ? Number(dto.priceVnd)
          : priceCreditsNum;
      if (!Number.isFinite(priceVndNum) || priceVndNum < 0) {
        throw new BizException(BizCode.BAD_REQUEST, 'priceVnd phải >= 0');
      }
      if (!Number.isFinite(priceCreditsNum) || priceCreditsNum < 0) {
        throw new BizException(BizCode.BAD_REQUEST, 'priceCredits phải >= 0');
      }
      if (isFree && (priceVndNum > 0 || priceCreditsNum > 0)) {
        throw new BizException(
          BizCode.BAD_REQUEST,
          'Tập miễn phí không được đặt giá > 0',
        );
      }
      if (!isFree && priceVndNum <= 0 && priceCreditsNum <= 0) {
        throw new BizException(
          BizCode.BAD_REQUEST,
          'Tập trả phí cần priceVnd hoặc priceCredits > 0',
        );
      }

      const priceCredits = toBigInt(priceCreditsNum);
      const priceVnd = isFree ? 0n : toBigInt(priceVndNum > 0 ? priceVndNum : priceCreditsNum);
      const source = String(dto.hlsUrl || dto.originalUrl || '').trim() || null;
      const sourceIsHls = !!source && /\.m3u8(?:\?|$)/i.test(source);
      if (source && !/^(https?:\/\/|uploads\/|hls\/)/i.test(source)) {
        throw new BizException(
          BizCode.BAD_REQUEST,
          '片源必须是 http(s) 地址，或 uploads/、hls/ 下的已上传文件',
        );
      }

      const ep = await this.prisma.$transaction(async (tx) => {
        const created = await tx.episode.create({
          data: {
            dramaId: drama.id,
            episodeNumber: Number(dto.episodeNumber),
            title: String(dto.title || '').trim() || `第 ${dto.episodeNumber} 集`,
            isFree,
            priceVnd: isFree ? 0n : priceVnd,
            priceCredits: isFree ? 0n : priceCredits,
            hlsUrl: source,
            originalUrl: String(dto.originalUrl || '').trim() || source,
            thumbnailUrl: String(dto.thumbnailUrl || '').trim() || null,
            uploadStatus: source ? 'COMPLETED' : 'PENDING',
            transcodeStatus: sourceIsHls ? 'COMPLETED' : 'PENDING',
          },
        });
        const totalEpisodes = await tx.episode.count({ where: { dramaId: drama.id } });
        await tx.drama.update({
          where: { id: drama.id },
          data: {
            totalEpisodes,
            ...(drama.status === 'REJECTED' ? { status: 'DRAFT' as const } : {}),
          },
        });
        return created;
      });
      return {
        id: ep.id.toString(),
        episodeNumber: ep.episodeNumber,
        hlsUrl: ep.hlsUrl,
        originalUrl: ep.originalUrl,
        transcodeStatus: ep.transcodeStatus,
        uploadStatus: ep.uploadStatus,
      };
    });
  }

  async getKycStatus(userId: bigint) {
    const creator = await this.ensureCreator(userId);
    return {
      kycStatus: creator.kycStatus,
      taxCode: creator.taxCode,
      bankVerified: creator.bankVerified,
    };
  }

  async submitKyc(userId: bigint, dto: any) {
    const creator = await this.ensureCreator(userId);

    const cccdNumber = String(dto.cccdNumber || '').trim();
    if (!/^\d{9}$|^\d{12}$/.test(cccdNumber)) {
      throw new BizException(BizCode.BAD_REQUEST, 'cccdNumber phải là 9 hoặc 12 chữ số');
    }
    const normalizeDoc = (u: string) => {
      const raw = String(u || '').trim();
      if (/^https?:\/\//i.test(raw)) return raw;
      let s = raw.split('?')[0].replace(/^\/+/, '');
      if (s.startsWith('api/v1/media/')) s = s.slice('api/v1/media/'.length);
      try {
        s = decodeURIComponent(s);
      } catch {
        /* keep */
      }
      s = s.replace(/\\/g, '/');
      if (s.startsWith('docs/')) return s;
      if (raw.startsWith('/api/v1/media/')) return s || null;
      return null;
    };
    const front = normalizeDoc(dto.cccdFrontUrl);
    const back = normalizeDoc(dto.cccdBackUrl);
    if (!front) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        'cccdFrontUrl phải là https://、/api/v1/media/ 或 docs/',
      );
    }
    if (!back) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        'cccdBackUrl phải là https://、/api/v1/media/ 或 docs/',
      );
    }
    // Client attestation only — admin KYC approval is the real gate for withdraw.
    const faceAttested =
      dto.faceVerified === true || dto.faceVerified === 'true' || dto.faceVerified === 1;
    if (!faceAttested) {
      throw new BizException(BizCode.BAD_REQUEST, 'faceVerified phải là true');
    }
    const taxCode = String(dto.taxCode || '').trim();
    if (!taxCode || taxCode.length < 5) {
      throw new BizException(BizCode.BAD_REQUEST, 'taxCode là bắt buộc');
    }
    if (
      dto.bankAccount == null ||
      (typeof dto.bankAccount === 'string' && !dto.bankAccount.trim()) ||
      (typeof dto.bankAccount === 'object' && Object.keys(dto.bankAccount).length === 0)
    ) {
      throw new BizException(BizCode.BAD_REQUEST, 'bankAccount là bắt buộc');
    }

    await this.prisma.creator.update({
      where: { id: creator.id },
      data: {
        cccdNumber,
        cccdFrontUrl: front,
        cccdBackUrl: back,
        faceVerified: false,
        taxCode,
        bankAccount: dto.bankAccount as any,
        bankVerified: false,
        kycStatus: 'PENDING',
        kycRejectReason: null,
      },
    });
    return { kycStatus: 'PENDING' };
  }
}

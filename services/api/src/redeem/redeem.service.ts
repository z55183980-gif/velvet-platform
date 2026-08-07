import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, RedeemCodeStatus, RedeemCodeType } from '@prisma/client';
import { createHmac, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import { AuditService } from '../common/audit.service';
import { toBigInt, genOrderNo, toDecimal } from '../common/money.util';
import { VipPlansService } from '../vip/vip-plans.service';

const WALLET_RETRY = 3;

function genCode(): string {
  const raw = randomBytes(8).toString('hex').toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

export function normalizeRedeemCode(raw: string): string {
  return (raw || '').trim().toUpperCase().replace(/\s+/g, '');
}

export function maskRedeemCode(normalized: string): string {
  const compact = normalized.replace(/-/g, '');
  const last4 = compact.slice(-4) || '????';
  return `****-****-****-${last4}`;
}

export function hashRedeemCode(normalized: string, pepper: string): string {
  return createHmac('sha256', pepper).update(normalized).digest('hex');
}

@Injectable()
export class RedeemService implements OnModuleInit {
  private readonly logger = new Logger(RedeemService.name);
  private readonly pepper: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {
    this.pepper =
      this.config.get<string>('REDEEM_CODE_PEPPER')?.trim() ||
      this.config.get<string>('JWT_SECRET')?.trim() ||
      'dev-secret';
  }

  async onModuleInit() {
    await this.backfillLegacyHashes();
  }

  private async backfillLegacyHashes() {
    try {
      const legacy = await this.prisma.redeemCode.findMany({
        where: { codeLegacy: { not: null }, OR: [{ codeHash: null }, { codeHash: '' }] },
        select: { id: true, codeLegacy: true },
        take: 5000,
      });
      if (!legacy.length) return;

      let migrated = 0;
      for (const row of legacy) {
        const normalized = normalizeRedeemCode(row.codeLegacy || '');
        if (!normalized) continue;
        const codeHash = hashRedeemCode(normalized, this.pepper);
        const codeHint = maskRedeemCode(normalized);
        try {
          await this.prisma.redeemCode.update({
            where: { id: row.id },
            data: { codeHash, codeHint, codeLegacy: null },
          });
          migrated += 1;
        } catch (err) {
          this.logger.warn(`Failed to migrate redeem code ${row.id}: ${(err as Error).message}`);
        }
      }
      this.logger.log(`Migrated ${migrated}/${legacy.length} legacy redeem codes to HMAC hashes`);
    } catch (err) {
      this.logger.warn(`Redeem code hash backfill skipped: ${(err as Error).message}`);
    }
  }

  /** 观众兑换卡密 */
  async redeem(userId: bigint, rawCode: string) {
    const code = normalizeRedeemCode(rawCode);
    if (!code) throw new BizException(BizCode.BAD_REQUEST, 'Mã không hợp lệ');

    return this.prisma.$transaction(async (tx) => {
      const codeHash = hashRedeemCode(code, this.pepper);
      let row = await tx.redeemCode.findUnique({ where: { codeHash } });
      if (!row) {
        const legacy = await tx.redeemCode.findUnique({ where: { codeLegacy: code } });
        if (legacy) {
          row = await tx.redeemCode.update({
            where: { id: legacy.id },
            data: { codeHash, codeHint: maskRedeemCode(code), codeLegacy: null },
          });
        }
      }
      if (!row) throw new BizException(BizCode.NOT_FOUND, 'Mã không tồn tại');
      if (row.status === 'VOID') throw new BizException(BizCode.FORBIDDEN, 'Mã đã bị vô hiệu');
      if (row.status === 'USED') throw new BizException(BizCode.CONFLICT, 'code.alreadyUsed');
      if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
        throw new BizException(BizCode.FORBIDDEN, 'Mã đã hết hạn');
      }

      const claimed = await tx.redeemCode.updateMany({
        where: { id: row.id, status: 'UNUSED' },
        data: { status: 'USED', usedByUserId: userId, usedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new BizException(BizCode.CONFLICT, 'code.alreadyUsed');
      }

      let vipExpireAt: Date | null = null;
      let orderId: bigint | null = null;
      let creditsGranted: bigint | null = null;

      if (row.type === 'VIP') {
        const days = row.vipDays ?? 0;
        if (days < 1) throw new BizException(BizCode.BAD_REQUEST, 'VIP days không hợp lệ');
        const user = await tx.user.findUnique({ where: { id: userId }, select: { vipExpireAt: true } });
        vipExpireAt = VipPlansService.computeExpireAt(user?.vipExpireAt, days);
        await tx.user.update({ where: { id: userId }, data: { vipExpireAt } });

        const order = await tx.order.create({
          data: {
            orderNo: genOrderNo('RD'),
            idempotencyKey: `redeem:vip:${row.id}:${userId}`,
            userId,
            orderType: 'VIP_SUB',
            amountVnd: 0n,
            amountCredits: 0n,
            creatorIncomeVnd: 0n,
            platformFeeVnd: 0n,
            payCurrency: 'CNY',
            payAmount: toDecimal(0),
            fxRate: toDecimal(1),
            fxSource: 'redeem',
            paymentMethod: 'WALLET',
            paymentStatus: 'PAID',
            paidAt: new Date(),
            meta: { redeemCodeId: row.id.toString(), vipDays: days } as any,
          },
        });
        orderId = order.id;
      } else {
        const credits = row.creditsAmount ?? 0n;
        if (credits <= 0n) throw new BizException(BizCode.BAD_REQUEST, 'Credits không hợp lệ');
        creditsGranted = credits;

        const order = await tx.order.create({
          data: {
            orderNo: genOrderNo('RD'),
            idempotencyKey: `redeem:credits:${row.id}:${userId}`,
            userId,
            orderType: 'TOPUP',
            amountVnd: 0n,
            amountCredits: credits,
            creatorIncomeVnd: 0n,
            platformFeeVnd: 0n,
            payCurrency: 'CNY',
            payAmount: toDecimal(0),
            fxRate: toDecimal(1),
            fxSource: 'redeem',
            paymentMethod: 'WALLET',
            paymentStatus: 'PAID',
            paidAt: new Date(),
            meta: { redeemCodeId: row.id.toString(), credits: credits.toString() } as any,
          },
        });
        orderId = order.id;

        await this.creditWallet(tx, userId, credits, order.id, 'Đổi mã thưởng');
      }

      await tx.redeemRedemption.create({
        data: {
          codeId: row.id,
          userId,
          type: row.type,
          vipDays: row.vipDays,
          creditsAmount: row.creditsAmount,
          vipExpireAt,
          orderId,
        },
      });

      return {
        type: row.type,
        vipDays: row.vipDays,
        creditsAmount: creditsGranted?.toString() ?? row.creditsAmount?.toString() ?? null,
        vipExpireAt: vipExpireAt?.toISOString() ?? null,
        orderId: orderId?.toString() ?? null,
      };
    });
  }

  private async creditWallet(
    tx: Prisma.TransactionClient,
    userId: bigint,
    credits: bigint,
    orderId: bigint,
    remark: string,
  ) {
    for (let attempt = 0; attempt < WALLET_RETRY; attempt++) {
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) {
        await tx.wallet.create({
          data: { userId, balanceCredits: credits, totalRechargedCredits: credits },
        });
        await tx.walletTransaction.create({
          data: {
            walletUserId: userId,
            type: 'TOPUP',
            amountCredits: credits,
            orderId,
            balanceAfter: credits,
            remark,
          },
        });
        return;
      }
      const newBalance = wallet.balanceCredits + credits;
      const res = await tx.wallet.updateMany({
        where: { userId, version: wallet.version },
        data: {
          balanceCredits: { increment: credits },
          totalRechargedCredits: { increment: credits },
          version: { increment: 1 },
        },
      });
      if (res.count === 1) {
        await tx.walletTransaction.create({
          data: {
            walletUserId: userId,
            type: 'TOPUP',
            amountCredits: credits,
            orderId,
            balanceAfter: newBalance,
            remark,
          },
        });
        return;
      }
    }
    throw new BizException(BizCode.CONFLICT, 'wallet.updateFailed');
  }

  // ---- Admin ----

  async createBatch(
    dto: {
      name?: string;
      type: 'VIP' | 'CREDITS';
      vipDays?: number;
      creditsAmount?: number | string;
      quantity: number;
      expiresAt?: string | null;
      note?: string;
    },
    actorId?: bigint | null,
  ) {
    const quantity = Math.floor(Number(dto.quantity));
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 5000) {
      throw new BizException(BizCode.BAD_REQUEST, 'quantity phải trong 1..5000');
    }
    const type = dto.type as RedeemCodeType;
    if (type !== 'VIP' && type !== 'CREDITS') {
      throw new BizException(BizCode.BAD_REQUEST, 'type phải là VIP hoặc CREDITS');
    }

    let vipDays: number | null = null;
    let creditsAmount: bigint | null = null;
    if (type === 'VIP') {
      vipDays = Math.floor(Number(dto.vipDays));
      if (!Number.isFinite(vipDays) || vipDays < 1) {
        throw new BizException(BizCode.BAD_REQUEST, 'vipDays phải >= 1');
      }
    } else {
      creditsAmount = toBigInt(dto.creditsAmount ?? 0);
      if (creditsAmount <= 0n) throw new BizException(BizCode.BAD_REQUEST, 'creditsAmount phải > 0');
    }

    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new BizException(BizCode.BAD_REQUEST, 'expiresAt không hợp lệ');
    }

    const codes: string[] = [];
    const used = new Set<string>();
    while (codes.length < quantity) {
      const c = genCode();
      if (used.has(c)) continue;
      used.add(c);
      codes.push(c);
    }

    const batch = await this.prisma.$transaction(async (tx) => {
      const b = await tx.redeemCodeBatch.create({
        data: {
          name: dto.name?.trim() || null,
          type,
          vipDays,
          creditsAmount,
          quantity,
          expiresAt,
          createdByAdminId: actorId ?? null,
          note: dto.note?.trim() || null,
        },
      });
      await tx.redeemCode.createMany({
        data: codes.map((code) => {
          const normalized = normalizeRedeemCode(code);
          return {
            batchId: b.id,
            codeHash: hashRedeemCode(normalized, this.pepper),
            codeHint: maskRedeemCode(normalized),
            codeLegacy: null,
            type,
            vipDays,
            creditsAmount,
            expiresAt,
          };
        }),
      });
      return b;
    });

    await this.audit.write({
      actorId,
      action: 'redeemBatch.create',
      targetType: 'redeemCodeBatch',
      targetId: batch.id.toString(),
      payload: { type, quantity, vipDays, creditsAmount: creditsAmount?.toString() },
    });

    return {
      batchId: batch.id.toString(),
      type,
      quantity,
      vipDays,
      creditsAmount: creditsAmount?.toString() ?? null,
      expiresAt: expiresAt?.toISOString() ?? null,
      codes, // 明文仅创建时返回一次
    };
  }

  async listBatches(page = 1, pageSize = 20) {
    const p = Math.max(1, page);
    const ps = Math.min(100, Math.max(5, pageSize));
    const [rows, total] = await Promise.all([
      this.prisma.redeemCodeBatch.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (p - 1) * ps,
        take: ps,
      }),
      this.prisma.redeemCodeBatch.count(),
    ]);

    const withStats = await Promise.all(
      rows.map(async (b) => {
        const [unused, used, voided] = await Promise.all([
          this.prisma.redeemCode.count({ where: { batchId: b.id, status: 'UNUSED' } }),
          this.prisma.redeemCode.count({ where: { batchId: b.id, status: 'USED' } }),
          this.prisma.redeemCode.count({ where: { batchId: b.id, status: 'VOID' } }),
        ]);
        return {
          id: b.id.toString(),
          name: b.name,
          type: b.type,
          vipDays: b.vipDays,
          creditsAmount: b.creditsAmount?.toString() ?? null,
          quantity: b.quantity,
          expiresAt: b.expiresAt,
          note: b.note,
          createdAt: b.createdAt,
          unused,
          used,
          voided,
        };
      }),
    );
    return { rows: withStats, total, page: p, pageSize: ps };
  }

  async listCodes(filter: {
    batchId?: string;
    status?: RedeemCodeStatus | 'ALL';
    code?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, Math.floor(filter.page ?? 1));
    const pageSize = Math.min(200, Math.max(5, Math.floor(filter.pageSize ?? 50)));
    const where: Prisma.RedeemCodeWhereInput = {};
    if (filter.batchId) where.batchId = BigInt(filter.batchId);
    if (filter.status && filter.status !== 'ALL') where.status = filter.status;

    const needle = normalizeRedeemCode(filter.code || '');
    if (needle) {
      if (needle.startsWith('****')) {
        where.codeHint = needle;
      } else {
        const codeHash = hashRedeemCode(needle, this.pepper);
        where.OR = [{ codeHash }, { codeLegacy: needle }];
      }
    }

    const [rows, total] = await Promise.all([
      this.prisma.redeemCode.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          usedBy: { select: { id: true, email: true, nickname: true, username: true } },
        },
      }),
      this.prisma.redeemCode.count({ where }),
    ]);

    return {
      rows: rows.map((r) => ({
        id: r.id.toString(),
        batchId: r.batchId.toString(),
        code: r.codeHint,
        codeHint: r.codeHint,
        type: r.type,
        vipDays: r.vipDays,
        creditsAmount: r.creditsAmount?.toString() ?? null,
        status: r.status,
        usedByUserId: r.usedByUserId?.toString() ?? null,
        usedBy: r.usedBy
          ? {
              id: r.usedBy.id.toString(),
              email: r.usedBy.email,
              nickname: r.usedBy.nickname,
              username: r.usedBy.username,
            }
          : null,
        usedAt: r.usedAt,
        expiresAt: r.expiresAt,
        createdAt: r.createdAt,
      })),
      total,
      page,
      pageSize,
    };
  }

  async voidCodes(ids: string[], actorId?: bigint | null) {
    if (!ids?.length) throw new BizException(BizCode.BAD_REQUEST, 'ids.empty');
    const bigIds = ids.map((id) => BigInt(id));
    const res = await this.prisma.redeemCode.updateMany({
      where: { id: { in: bigIds }, status: 'UNUSED' },
      data: { status: 'VOID' },
    });
    await this.audit.write({
      actorId,
      action: 'redeemCode.void',
      targetType: 'redeemCode',
      payload: { ids, voided: res.count },
    });
    return { voided: res.count };
  }

  async voidBatch(batchId: string, actorId?: bigint | null) {
    const id = BigInt(batchId);
    const res = await this.prisma.redeemCode.updateMany({
      where: { batchId: id, status: 'UNUSED' },
      data: { status: 'VOID' },
    });
    await this.audit.write({
      actorId,
      action: 'redeemBatch.void',
      targetType: 'redeemCodeBatch',
      targetId: batchId,
      payload: { voided: res.count },
    });
    return { voided: res.count };
  }

  /** 导出批次状态 CSV（掩码码，不含明文） */
  async exportCsv(batchId: string) {
    const id = BigInt(batchId);
    const rows = await this.prisma.redeemCode.findMany({
      where: { batchId: id },
      orderBy: { id: 'asc' },
    });
    const header = 'codeHint,type,vipDays,creditsAmount,status,usedByUserId,usedAt,expiresAt\n';
    const body = rows
      .map((r) =>
        [
          r.codeHint,
          r.type,
          r.vipDays ?? '',
          r.creditsAmount?.toString() ?? '',
          r.status,
          r.usedByUserId?.toString() ?? '',
          r.usedAt?.toISOString() ?? '',
          r.expiresAt?.toISOString() ?? '',
        ].join(','),
      )
      .join('\n');
    return header + body + (body ? '\n' : '');
  }

  async listRedemptions(filter: {
    batchId?: string;
    page?: number;
    pageSize?: number;
  } = {}) {
    const p = Math.max(1, filter.page ?? 1);
    const ps = Math.min(100, Math.max(5, filter.pageSize ?? 20));
    const where: Prisma.RedeemRedemptionWhereInput = {};
    if (filter.batchId) where.code = { batchId: BigInt(filter.batchId) };

    const [rows, total] = await Promise.all([
      this.prisma.redeemRedemption.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (p - 1) * ps,
        take: ps,
        include: {
          user: { select: { id: true, email: true, nickname: true, username: true } },
          code: { select: { codeHint: true, batchId: true } },
        },
      }),
      this.prisma.redeemRedemption.count({ where }),
    ]);
    return {
      rows: rows.map((r) => ({
        id: r.id.toString(),
        type: r.type,
        vipDays: r.vipDays,
        creditsAmount: r.creditsAmount?.toString() ?? null,
        vipExpireAt: r.vipExpireAt,
        orderId: r.orderId?.toString() ?? null,
        createdAt: r.createdAt,
        code: r.code.codeHint,
        codeHint: r.code.codeHint,
        batchId: r.code.batchId.toString(),
        user: {
          id: r.user.id.toString(),
          email: r.user.email,
          nickname: r.user.nickname,
          username: r.user.username,
        },
      })),
      total,
      page: p,
      pageSize: ps,
    };
  }
}

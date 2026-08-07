import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import { AuditService } from '../common/audit.service';

const PAY_CURRENCY = 'USD';

export type TopupPackageInput = {
  name?: string | null;
  /** Immediate credits (必填：立即) */
  baseCredits: number | string;
  /** Bonus credits (可选：免费/赠送) */
  bonusCredits?: number | string | null;
  basePrice: number | string;
  sortOrder?: number;
  active?: boolean;
  badge?: string | null;
  /** @deprecated prefer baseCredits + bonusCredits; kept for callers that still send total */
  credits?: number | string;
};

@Injectable()
export class PackagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private roundedUsd(basePrice: Prisma.Decimal | number | string) {
    const payAmount = new Prisma.Decimal(basePrice.toString()).toDecimalPlaces(
      2,
      Prisma.Decimal.ROUND_HALF_UP,
    );
    return {
      currency: PAY_CURRENCY,
      payAmount: payAmount.toString(),
    };
  }

  private resolveCredits(dto: {
    baseCredits?: number | string | null;
    bonusCredits?: number | string | null;
    credits?: number | string | null;
  }) {
    const bonusRaw = dto.bonusCredits == null || dto.bonusCredits === '' ? 0 : Number(dto.bonusCredits);
    const bonusCredits = Math.floor(bonusRaw);
    if (!Number.isFinite(bonusCredits) || bonusCredits < 0) {
      throw new BizException(BizCode.BAD_REQUEST, 'validation.bonusCreditsMin');
    }

    let baseCredits: number;
    if (dto.baseCredits != null && dto.baseCredits !== '') {
      baseCredits = Math.floor(Number(dto.baseCredits));
    } else if (dto.credits != null && dto.credits !== '') {
      // Legacy: treat total as immediate when split fields absent
      baseCredits = Math.floor(Number(dto.credits)) - bonusCredits;
    } else {
      throw new BizException(BizCode.BAD_REQUEST, 'validation.baseCreditsMin');
    }

    if (!Number.isFinite(baseCredits) || baseCredits < 1) {
      throw new BizException(BizCode.BAD_REQUEST, 'validation.baseCreditsMin');
    }

    const credits = baseCredits + bonusCredits;
    if (credits < 1) {
      throw new BizException(BizCode.BAD_REQUEST, 'validation.creditsMin');
    }
    return { baseCredits, bonusCredits, credits };
  }

  private view(
    row: {
      id: bigint;
      name: string | null;
      baseCredits: bigint;
      bonusCredits: bigint;
      credits: bigint;
      baseCurrency: string;
      basePrice: Prisma.Decimal;
      sortOrder: number;
      active: boolean;
      badge: string | null;
      updatedAt?: Date;
    },
    pay?: { currency: string; payAmount: string },
  ) {
    return {
      id: row.id.toString(),
      name: row.name,
      baseCredits: row.baseCredits.toString(),
      bonusCredits: row.bonusCredits.toString(),
      credits: row.credits.toString(),
      baseCurrency: row.baseCurrency,
      basePrice: row.basePrice.toString(),
      sortOrder: row.sortOrder,
      active: row.active,
      badge: row.badge,
      updatedAt: row.updatedAt,
      ...(pay
        ? {
            payCurrency: pay.currency,
            payAmount: pay.payAmount,
          }
        : {}),
    };
  }

  /** 前台：启用中的套餐，直接按 USD 标价（无汇率折算） */
  async listPublic(_currency = PAY_CURRENCY) {
    const rows = await this.prisma.topupPackage.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => this.view(r, this.roundedUsd(r.basePrice)));
  }

  async listAdmin() {
    const rows = await this.prisma.topupPackage.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => this.view(r));
  }

  async getActive(id: bigint) {
    const row = await this.prisma.topupPackage.findUnique({ where: { id } });
    if (!row || !row.active) {
      throw new BizException(BizCode.NOT_FOUND, 'Gói nạp không tồn tại hoặc đã tắt');
    }
    return row;
  }

  async create(dto: TopupPackageInput, actorId?: bigint | null) {
    const name = dto.name?.trim() || null;
    const { baseCredits, bonusCredits, credits } = this.resolveCredits(dto);
    const basePrice = new Prisma.Decimal(dto.basePrice as any);
    if (basePrice.lte(0)) throw new BizException(BizCode.BAD_REQUEST, 'validation.basePricePositive');

    const row = await this.prisma.topupPackage.create({
      data: {
        name: name || `${credits}`,
        baseCredits: BigInt(baseCredits),
        bonusCredits: BigInt(bonusCredits),
        credits: BigInt(credits),
        baseCurrency: PAY_CURRENCY,
        basePrice,
        sortOrder: dto.sortOrder ?? 0,
        active: dto.active !== false,
        badge: dto.badge?.trim() || null,
      },
    });
    await this.audit.write({
      actorId,
      action: 'topupPackage.create',
      targetType: 'topupPackage',
      targetId: row.id.toString(),
      payload: this.view(row),
    });
    return this.view(row);
  }

  async update(id: bigint, dto: Partial<TopupPackageInput>, actorId?: bigint | null) {
    const prev = await this.prisma.topupPackage.findUnique({ where: { id } });
    if (!prev) throw new BizException(BizCode.NOT_FOUND, 'Gói nạp không tồn tại');

    const data: Prisma.TopupPackageUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name?.trim() || null;
      data.name = name || prev.name || `${prev.credits}`;
    }

    const touchingCredits =
      dto.baseCredits !== undefined ||
      dto.bonusCredits !== undefined ||
      dto.credits !== undefined;
    if (touchingCredits) {
      const resolved = this.resolveCredits({
        baseCredits: dto.baseCredits !== undefined ? dto.baseCredits : prev.baseCredits.toString(),
        bonusCredits:
          dto.bonusCredits !== undefined ? dto.bonusCredits : prev.bonusCredits.toString(),
        credits: dto.credits,
      });
      data.baseCredits = BigInt(resolved.baseCredits);
      data.bonusCredits = BigInt(resolved.bonusCredits);
      data.credits = BigInt(resolved.credits);
    }

    if (dto.basePrice !== undefined) {
      const basePrice = new Prisma.Decimal(dto.basePrice as any);
      if (basePrice.lte(0)) throw new BizException(BizCode.BAD_REQUEST, 'validation.basePricePositive');
      data.basePrice = basePrice;
    }
    if (dto.sortOrder !== undefined) data.sortOrder = Number(dto.sortOrder) || 0;
    if (dto.active !== undefined) data.active = !!dto.active;
    if (dto.badge !== undefined) data.badge = dto.badge?.trim() || null;

    const row = await this.prisma.topupPackage.update({ where: { id }, data });
    await this.audit.write({
      actorId,
      action: 'topupPackage.update',
      targetType: 'topupPackage',
      targetId: row.id.toString(),
      payload: { prev: this.view(prev), next: this.view(row) },
    });
    return this.view(row);
  }

  async remove(id: bigint, actorId?: bigint | null) {
    const prev = await this.prisma.topupPackage.findUnique({ where: { id } });
    if (!prev) throw new BizException(BizCode.NOT_FOUND, 'Gói nạp không tồn tại');

    const orderCount = await this.prisma.order.count({ where: { packageId: id } });
    if (orderCount > 0) {
      throw new BizException(BizCode.BAD_REQUEST, 'topupPackage.hasOrders');
    }

    await this.prisma.topupPackage.delete({ where: { id } });
    await this.audit.write({
      actorId,
      action: 'topupPackage.delete',
      targetType: 'topupPackage',
      targetId: id.toString(),
      payload: this.view(prev),
    });
    return { id: id.toString(), deleted: true };
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import { AuditService } from '../common/audit.service';
import type { ApiLocale } from '../common/i18n/locale';

export type VipPlanInput = {
  name?: string | null;
  nameEn?: string | null;
  nameZh?: string | null;
  nameFr?: string | null;
  durationDays: number | string;
  basePrice: number | string;
  sortOrder?: number;
  active?: boolean;
  badge?: string | null;
};

const PAY_CURRENCY = 'USD';

type VipPlanNameRow = {
  name: string | null;
  nameEn: string;
  nameZh: string | null;
  nameFr: string | null;
};

function optionalName(value?: string | null) {
  return value?.trim() || null;
}

function localizedPlanName(row: VipPlanNameRow, locale: ApiLocale = 'en') {
  const localized = {
    en: row.nameEn,
    zh: row.nameZh,
    fr: row.nameFr,
  }[locale];
  return optionalName(localized) || optionalName(row.nameEn) || optionalName(row.name) || '';
}

@Injectable()
export class VipPlansService {
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

  private view(
    row: VipPlanNameRow & {
      id: bigint;
      durationDays: number;
      baseCurrency: string;
      basePrice: Prisma.Decimal;
      sortOrder: number;
      active: boolean;
      badge: string | null;
      updatedAt?: Date;
    },
    pay?: { currency: string; payAmount: string },
    locale: ApiLocale = 'en',
  ) {
    return {
      id: row.id.toString(),
      name: localizedPlanName(row, locale),
      nameEn: row.nameEn,
      nameZh: row.nameZh,
      nameFr: row.nameFr,
      durationDays: row.durationDays,
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

  /** 前台：启用中的 VIP 套餐，直接按 USD 标价（无汇率折算） */
  async listPublic(_currency = PAY_CURRENCY, locale: ApiLocale = 'en') {
    const rows = await this.prisma.vipPlan.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => this.view(r, this.roundedUsd(r.basePrice), locale));
  }

  async listAdmin() {
    const rows = await this.prisma.vipPlan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => this.view(r));
  }

  async getActive(id: bigint) {
    const row = await this.prisma.vipPlan.findUnique({ where: { id } });
    if (!row || !row.active) {
      throw new BizException(BizCode.NOT_FOUND, 'Gói VIP không tồn tại hoặc đã tắt');
    }
    return row;
  }

  async create(dto: VipPlanInput, actorId?: bigint | null) {
    const durationDays = Math.floor(Number(dto.durationDays));
    const basePrice = new Prisma.Decimal(dto.basePrice as any);
    const nameEn = optionalName(dto.nameEn) || optionalName(dto.name);
    if (!nameEn) {
      throw new BizException(BizCode.BAD_REQUEST, 'validation.nameEnRequired');
    }
    if (!Number.isFinite(durationDays) || durationDays < 1) {
      throw new BizException(BizCode.BAD_REQUEST, 'validation.durationDaysMin');
    }
    if (basePrice.lte(0)) throw new BizException(BizCode.BAD_REQUEST, 'validation.basePricePositive');

    const row = await this.prisma.vipPlan.create({
      data: {
        name: nameEn,
        nameEn,
        nameZh: optionalName(dto.nameZh),
        nameFr: optionalName(dto.nameFr),
        durationDays,
        baseCurrency: PAY_CURRENCY,
        basePrice,
        sortOrder: dto.sortOrder ?? 0,
        active: dto.active !== false,
        badge: dto.badge?.trim() || null,
      },
    });
    await this.audit.write({
      actorId,
      action: 'vipPlan.create',
      targetType: 'vipPlan',
      targetId: row.id.toString(),
      payload: this.view(row),
    });
    return this.view(row);
  }

  async update(id: bigint, dto: Partial<VipPlanInput>, actorId?: bigint | null) {
    const prev = await this.prisma.vipPlan.findUnique({ where: { id } });
    if (!prev) throw new BizException(BizCode.NOT_FOUND, 'Gói VIP không tồn tại');

    const data: Prisma.VipPlanUpdateInput = {};
    if (dto.nameEn !== undefined || dto.name !== undefined) {
      const nameEn = optionalName(dto.nameEn) || optionalName(dto.name);
      if (!nameEn) {
        throw new BizException(BizCode.BAD_REQUEST, 'validation.nameEnRequired');
      }
      data.name = nameEn;
      data.nameEn = nameEn;
    }
    if (dto.nameZh !== undefined) data.nameZh = optionalName(dto.nameZh);
    if (dto.nameFr !== undefined) data.nameFr = optionalName(dto.nameFr);
    if (dto.durationDays !== undefined) {
      const durationDays = Math.floor(Number(dto.durationDays));
      if (!Number.isFinite(durationDays) || durationDays < 1) {
        throw new BizException(BizCode.BAD_REQUEST, 'validation.durationDaysMin');
      }
      data.durationDays = durationDays;
    }
    if (dto.basePrice !== undefined) {
      const basePrice = new Prisma.Decimal(dto.basePrice as any);
      if (basePrice.lte(0)) throw new BizException(BizCode.BAD_REQUEST, 'validation.basePricePositive');
      data.basePrice = basePrice;
    }
    if (dto.sortOrder !== undefined) data.sortOrder = Number(dto.sortOrder) || 0;
    if (dto.active !== undefined) data.active = !!dto.active;
    if (dto.badge !== undefined) data.badge = dto.badge?.trim() || null;

    const row = await this.prisma.vipPlan.update({ where: { id }, data });
    await this.audit.write({
      actorId,
      action: 'vipPlan.update',
      targetType: 'vipPlan',
      targetId: row.id.toString(),
      payload: { prev: this.view(prev), next: this.view(row) },
    });
    return this.view(row);
  }

  /** 从基准日起叠加 durationDays；未过期则从当前到期日续 */
  static computeExpireAt(currentExpireAt: Date | null | undefined, durationDays: number, now = new Date()) {
    const base =
      currentExpireAt && currentExpireAt.getTime() > now.getTime() ? currentExpireAt : now;
    return new Date(base.getTime() + durationDays * 24 * 60 * 60 * 1000);
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import { AuditService } from '../common/audit.service';
import type { ApiLocale } from '../common/i18n/locale';

const DEFAULT_BENEFITS = ['Unlimited Viewing', '1080p High Quality'];
const DEFAULT_DESC_EN = 'Auto-renew. Cancel anytime.';
const PAY_CURRENCY = 'USD';

export type VipPlanInput = {
  name?: string | null;
  nameEn?: string | null;
  nameZh?: string | null;
  nameFr?: string | null;
  durationDays: number | string;
  basePrice: number | string;
  originalPrice?: number | string | null;
  sortOrder?: number;
  active?: boolean;
  badge?: string | null;
  descEn?: string | null;
  descZh?: string | null;
  descFr?: string | null;
  benefits?: string[] | string | null;
};

type VipPlanNameRow = {
  name: string | null;
  nameEn: string;
  nameZh: string | null;
  nameFr: string | null;
};

type VipPlanDescRow = {
  descEn: string;
  descZh: string | null;
  descFr: string | null;
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

function localizedPlanDesc(row: VipPlanDescRow, locale: ApiLocale = 'en') {
  const localized = {
    en: row.descEn,
    zh: row.descZh,
    fr: row.descFr,
  }[locale];
  return optionalName(localized) || optionalName(row.descEn) || DEFAULT_DESC_EN;
}

function parseBenefits(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x ?? '').trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x ?? '').trim()).filter(Boolean);
      }
    } catch {
      /* newline / comma list */
    }
    return trimmed
      .split(/\n|,/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeBenefits(input?: string[] | string | null): string[] {
  const list = parseBenefits(input ?? DEFAULT_BENEFITS);
  if (list.length < 1) {
    throw new BizException(BizCode.BAD_REQUEST, 'validation.vipBenefitsRequired');
  }
  return list.slice(0, 12);
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
    row: VipPlanNameRow &
      VipPlanDescRow & {
        id: bigint;
        durationDays: number;
        baseCurrency: string;
        basePrice: Prisma.Decimal;
        originalPrice: Prisma.Decimal | null;
        sortOrder: number;
        active: boolean;
        badge: string | null;
        benefits: Prisma.JsonValue;
        updatedAt?: Date;
      },
    pay?: { currency: string; payAmount: string },
    locale: ApiLocale = 'en',
  ) {
    const benefits = parseBenefits(row.benefits);
    return {
      id: row.id.toString(),
      name: localizedPlanName(row, locale),
      nameEn: row.nameEn,
      nameZh: row.nameZh,
      nameFr: row.nameFr,
      durationDays: row.durationDays,
      baseCurrency: row.baseCurrency,
      basePrice: row.basePrice.toString(),
      originalPrice: row.originalPrice != null ? row.originalPrice.toString() : null,
      sortOrder: row.sortOrder,
      active: row.active,
      badge: row.badge,
      desc: localizedPlanDesc(row, locale),
      descEn: row.descEn,
      descZh: row.descZh,
      descFr: row.descFr,
      benefits,
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
    const descEn = optionalName(dto.descEn) || DEFAULT_DESC_EN;
    const benefits = normalizeBenefits(dto.benefits);
    if (!nameEn) {
      throw new BizException(BizCode.BAD_REQUEST, 'validation.nameEnRequired');
    }
    if (!Number.isFinite(durationDays) || durationDays < 1) {
      throw new BizException(BizCode.BAD_REQUEST, 'validation.durationDaysMin');
    }
    if (basePrice.lte(0)) throw new BizException(BizCode.BAD_REQUEST, 'validation.basePricePositive');

    let originalPrice: Prisma.Decimal | null = null;
    if (dto.originalPrice != null && dto.originalPrice !== '') {
      originalPrice = new Prisma.Decimal(dto.originalPrice as any);
      if (originalPrice.lte(0)) {
        throw new BizException(BizCode.BAD_REQUEST, 'validation.originalPricePositive');
      }
    }

    const row = await this.prisma.vipPlan.create({
      data: {
        name: nameEn,
        nameEn,
        nameZh: optionalName(dto.nameZh),
        nameFr: optionalName(dto.nameFr),
        durationDays,
        baseCurrency: PAY_CURRENCY,
        basePrice,
        originalPrice,
        sortOrder: dto.sortOrder ?? 0,
        active: dto.active !== false,
        badge: dto.badge?.trim() || null,
        descEn,
        descZh: optionalName(dto.descZh),
        descFr: optionalName(dto.descFr),
        benefits,
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
    if (dto.originalPrice !== undefined) {
      if (dto.originalPrice == null || dto.originalPrice === '') {
        data.originalPrice = null;
      } else {
        const originalPrice = new Prisma.Decimal(dto.originalPrice as any);
        if (originalPrice.lte(0)) {
          throw new BizException(BizCode.BAD_REQUEST, 'validation.originalPricePositive');
        }
        data.originalPrice = originalPrice;
      }
    }
    if (dto.sortOrder !== undefined) data.sortOrder = Number(dto.sortOrder) || 0;
    if (dto.active !== undefined) data.active = !!dto.active;
    if (dto.badge !== undefined) data.badge = dto.badge?.trim() || null;
    if (dto.descEn !== undefined) {
      const descEn = optionalName(dto.descEn);
      if (!descEn) throw new BizException(BizCode.BAD_REQUEST, 'validation.vipDescRequired');
      data.descEn = descEn;
    }
    if (dto.descZh !== undefined) data.descZh = optionalName(dto.descZh);
    if (dto.descFr !== undefined) data.descFr = optionalName(dto.descFr);
    if (dto.benefits !== undefined) data.benefits = normalizeBenefits(dto.benefits);

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

  async remove(id: bigint, actorId?: bigint | null) {
    const prev = await this.prisma.vipPlan.findUnique({ where: { id } });
    if (!prev) throw new BizException(BizCode.NOT_FOUND, 'Gói VIP không tồn tại');

    const orderCount = await this.prisma.order.count({ where: { vipPlanId: id } });
    if (orderCount > 0) {
      throw new BizException(BizCode.BAD_REQUEST, 'vipPlan.hasOrders');
    }

    await this.prisma.vipPlan.delete({ where: { id } });
    await this.audit.write({
      actorId,
      action: 'vipPlan.delete',
      targetType: 'vipPlan',
      targetId: id.toString(),
      payload: this.view(prev),
    });
    return { id: id.toString(), deleted: true };
  }

  /** 从基准日起叠加 durationDays；未过期则从当前到期日续 */
  static computeExpireAt(currentExpireAt: Date | null | undefined, durationDays: number, now = new Date()) {
    const base =
      currentExpireAt && currentExpireAt.getTime() > now.getTime() ? currentExpireAt : now;
    return new Date(base.getTime() + durationDays * 24 * 60 * 60 * 1000);
  }
}

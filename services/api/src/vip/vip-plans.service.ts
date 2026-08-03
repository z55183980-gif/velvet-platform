import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import { AuditService } from '../common/audit.service';
import { ExchangeService } from '../exchange/exchange.service';

export type VipPlanInput = {
  name?: string | null;
  durationDays: number | string;
  basePrice: number | string;
  sortOrder?: number;
  active?: boolean;
  badge?: string | null;
};

@Injectable()
export class VipPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exchange: ExchangeService,
    private readonly audit: AuditService,
  ) {}

  private view(
    row: {
      id: bigint;
      name: string | null;
      durationDays: number;
      baseCurrency: string;
      basePrice: Prisma.Decimal;
      sortOrder: number;
      active: boolean;
      badge: string | null;
      updatedAt?: Date;
    },
    pay?: { currency: string; payAmount: string; cnyToFiat: string },
  ) {
    return {
      id: row.id.toString(),
      name: row.name,
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
            cnyToFiat: pay.cnyToFiat,
          }
        : {}),
    };
  }

  async listPublic(currency = 'CNY') {
    const cur = currency.toUpperCase();
    const rows = await this.prisma.vipPlan.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    const out: Array<{
      id: string;
      name: string | null;
      durationDays: number;
      baseCurrency: string;
      basePrice: string;
      sortOrder: number;
      active: boolean;
      badge: string | null;
      updatedAt?: Date;
      payCurrency?: string;
      payAmount?: string;
      cnyToFiat?: string;
    }> = [];
    for (const r of rows) {
      const q = await this.exchange.quoteBasePrice(r.basePrice, cur);
      out.push(this.view(r, { currency: cur, payAmount: q.payAmount, cnyToFiat: q.cnyToFiat }));
    }
    return out;
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
    if (!Number.isFinite(durationDays) || durationDays < 1) {
      throw new BizException(BizCode.BAD_REQUEST, 'durationDays phải >= 1');
    }
    if (basePrice.lte(0)) throw new BizException(BizCode.BAD_REQUEST, 'basePrice phải > 0');

    const row = await this.prisma.vipPlan.create({
      data: {
        name: dto.name?.trim() || null,
        durationDays,
        baseCurrency: 'CNY',
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
    if (dto.name !== undefined) data.name = dto.name?.trim() || null;
    if (dto.durationDays !== undefined) {
      const durationDays = Math.floor(Number(dto.durationDays));
      if (!Number.isFinite(durationDays) || durationDays < 1) {
        throw new BizException(BizCode.BAD_REQUEST, 'durationDays phải >= 1');
      }
      data.durationDays = durationDays;
    }
    if (dto.basePrice !== undefined) {
      const basePrice = new Prisma.Decimal(dto.basePrice as any);
      if (basePrice.lte(0)) throw new BizException(BizCode.BAD_REQUEST, 'basePrice phải > 0');
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

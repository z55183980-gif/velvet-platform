import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import { AuditService } from '../common/audit.service';
import { ExchangeService } from '../exchange/exchange.service';

export type PackageInput = {
  name?: string | null;
  credits: number | string;
  basePrice: number | string;
  sortOrder?: number;
  active?: boolean;
};

@Injectable()
export class PackagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exchange: ExchangeService,
    private readonly audit: AuditService,
  ) {}

  private view(
    row: {
      id: bigint;
      name: string | null;
      credits: bigint;
      baseCurrency: string;
      basePrice: Prisma.Decimal;
      sortOrder: number;
      active: boolean;
      updatedAt?: Date;
    },
    pay?: { currency: string; payAmount: string; cnyToFiat: string },
  ) {
    return {
      id: row.id.toString(),
      name: row.name,
      credits: row.credits.toString(),
      baseCurrency: row.baseCurrency,
      basePrice: row.basePrice.toString(),
      sortOrder: row.sortOrder,
      active: row.active,
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

  /** 前台：启用中的套餐 + 指定币种应付金额 */
  async listPublic(currency = 'CNY') {
    const cur = currency.toUpperCase();
    const rows = await this.prisma.topupPackage.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    const out: Array<{
      id: string;
      name: string | null;
      credits: string;
      baseCurrency: string;
      basePrice: string;
      sortOrder: number;
      active: boolean;
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

  /** 管理端：全部套餐 */
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

  async create(dto: PackageInput, actorId?: bigint | null) {
    const credits = BigInt(String(dto.credits));
    const basePrice = new Prisma.Decimal(dto.basePrice as any);
    if (credits <= 0n) throw new BizException(BizCode.BAD_REQUEST, 'credits phải > 0');
    if (basePrice.lte(0)) throw new BizException(BizCode.BAD_REQUEST, 'basePrice phải > 0');

    const row = await this.prisma.topupPackage.create({
      data: {
        name: dto.name?.trim() || null,
        credits,
        baseCurrency: 'CNY',
        basePrice,
        sortOrder: dto.sortOrder ?? 0,
        active: dto.active !== false,
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

  async update(id: bigint, dto: Partial<PackageInput>, actorId?: bigint | null) {
    const prev = await this.prisma.topupPackage.findUnique({ where: { id } });
    if (!prev) throw new BizException(BizCode.NOT_FOUND, 'Gói nạp không tồn tại');

    const data: Prisma.TopupPackageUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name?.trim() || null;
    if (dto.credits !== undefined) {
      const credits = BigInt(String(dto.credits));
      if (credits <= 0n) throw new BizException(BizCode.BAD_REQUEST, 'credits phải > 0');
      data.credits = credits;
    }
    if (dto.basePrice !== undefined) {
      const basePrice = new Prisma.Decimal(dto.basePrice as any);
      if (basePrice.lte(0)) throw new BizException(BizCode.BAD_REQUEST, 'basePrice phải > 0');
      data.basePrice = basePrice;
    }
    if (dto.sortOrder !== undefined) data.sortOrder = Number(dto.sortOrder) || 0;
    if (dto.active !== undefined) data.active = !!dto.active;

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
}

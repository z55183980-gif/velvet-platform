import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';

const PAY_CURRENCY = 'USD';

@Injectable()
export class PackagesService {
  constructor(private readonly prisma: PrismaService) {}

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
    pay?: { currency: string; payAmount: string },
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

  async getActive(id: bigint) {
    const row = await this.prisma.topupPackage.findUnique({ where: { id } });
    if (!row || !row.active) {
      throw new BizException(BizCode.NOT_FOUND, 'Gói nạp không tồn tại hoặc đã tắt');
    }
    return row;
  }
}

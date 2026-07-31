import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import { AuditService } from '../common/audit.service';

/**
 * 法币相对人民币汇率。
 * CreditExchangeRate.buyRate = cnyToFiat：1 CNY = N 单位该币种（CNY 自身为 1）。
 * 套餐应付：payAmount = basePriceCNY × cnyToFiat。
 */
@Injectable()
export class ExchangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getRates() {
    const rows = await this.prisma.creditExchangeRate.findMany({ orderBy: { currency: 'asc' } });
    return rows.map((r) => this.toRateView(r));
  }

  async getRate(currency: string) {
    const r = await this.prisma.creditExchangeRate.findUnique({
      where: { currency: currency.toUpperCase() },
    });
    if (!r) throw new BizException(BizCode.NOT_FOUND, `Chưa cấu hình tỷ giá cho ${currency}`);
    return r;
  }

  /** 1 CNY = ? 该币种 */
  async getCnyToFiat(currency: string): Promise<Prisma.Decimal> {
    const cur = currency.toUpperCase();
    if (cur === 'CNY') return new Prisma.Decimal(1);
    const r = await this.getRate(cur);
    return r.buyRate;
  }

  /**
   * 将套餐人民币基准价折算为支付币种金额。
   * fxRate 快照存 cnyToFiat。
   */
  async quoteBasePrice(basePriceCny: Prisma.Decimal | number | string, currency: string) {
    const cur = currency.toUpperCase();
    const base = new Prisma.Decimal(basePriceCny.toString());
    if (base.lte(0)) throw new BizException(BizCode.BAD_REQUEST, 'basePrice không hợp lệ');
    const cnyToFiat = await this.getCnyToFiat(cur);
    const payAmount = base.mul(cnyToFiat);
    // VND 等无小数币种：向上取整到整数；CNY 保留 2 位
    const rounded =
      cur === 'VND' || cur === 'JPY' || cur === 'KRW'
        ? payAmount.toDecimalPlaces(0, Prisma.Decimal.ROUND_CEIL)
        : payAmount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    return {
      currency: cur,
      payAmount: rounded.toString(),
      cnyToFiat: cnyToFiat.toString(),
      basePriceCny: base.toString(),
    };
  }

  /** 记账用：支付法币金额 → 约合 VND（用各自相对 CNY 的汇率换算） */
  async fiatToVnd(currency: string, fiatAmount: Prisma.Decimal | number | string): Promise<bigint> {
    const cur = currency.toUpperCase();
    const amt = new Prisma.Decimal(fiatAmount.toString());
    if (cur === 'VND') return BigInt(amt.toDecimalPlaces(0, Prisma.Decimal.ROUND_FLOOR).toString());
    // fiat → CNY → VND
    const cnyToFiat = await this.getCnyToFiat(cur);
    const cny = amt.div(cnyToFiat);
    const cnyToVnd = await this.getCnyToFiat('VND');
    return BigInt(cny.mul(cnyToVnd).toDecimalPlaces(0, Prisma.Decimal.ROUND_FLOOR).toString());
  }

  async upsertRate(
    dto: { currency: string; cnyToFiat: number | string; sellRate?: number | string },
    actorId?: bigint | null,
  ) {
    const currency = dto.currency.toUpperCase();
    const cnyToFiat = new Prisma.Decimal(dto.cnyToFiat as any);
    if (cnyToFiat.lte(0)) {
      throw new BizException(BizCode.BAD_REQUEST, 'cnyToFiat phải > 0');
    }
    if (currency === 'CNY' && !cnyToFiat.eq(1)) {
      throw new BizException(BizCode.BAD_REQUEST, 'CNY 的 cnyToFiat 必须为 1');
    }
    const sellRate = new Prisma.Decimal((dto.sellRate ?? dto.cnyToFiat) as any);
    if (sellRate.lte(0)) {
      throw new BizException(BizCode.BAD_REQUEST, 'sellRate phải > 0');
    }

    const prev = await this.prisma.creditExchangeRate.findUnique({ where: { currency } });
    const data = { buyRate: cnyToFiat, sellRate };
    const row = await this.prisma.creditExchangeRate.upsert({
      where: { currency },
      create: { currency, ...data },
      update: data,
    });
    await this.audit.write({
      actorId,
      action: 'exchangeRate.upsert',
      targetType: 'exchangeRate',
      targetId: row.currency,
      payload: {
        prev: prev ? this.toRateView(prev) : null,
        next: this.toRateView(row),
      },
    });
    await this.prisma.exchangeRateHistory.create({
      data: {
        currency: row.currency,
        prevBuyRate: prev?.buyRate ?? null,
        prevSellRate: prev?.sellRate ?? null,
        newBuyRate: row.buyRate,
        newSellRate: row.sellRate,
        actorId: actorId ?? null,
        reason: 'cnyToFiat',
      },
    });
    return this.toRateView(row);
  }

  /** @deprecated 兼容旧管理端字段名 buyRate */
  async upsertRateLegacy(
    dto: { currency: string; buyRate: number | string; sellRate: number | string },
    actorId?: bigint | null,
  ) {
    return this.upsertRate(
      { currency: dto.currency, cnyToFiat: dto.buyRate, sellRate: dto.sellRate },
      actorId,
    );
  }

  async listRateHistory(page = 1, pageSize = 30, currency?: string) {
    const where = currency ? { currency } : undefined;
    const [rows, total] = await Promise.all([
      this.prisma.exchangeRateHistory.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.exchangeRateHistory.count({ where }),
    ]);
    return {
      rows: rows.map((r) => ({
        id: r.id.toString(),
        currency: r.currency,
        prevCnyToFiat: r.prevBuyRate?.toString() ?? null,
        prevSellRate: r.prevSellRate?.toString() ?? null,
        cnyToFiat: r.newBuyRate.toString(),
        sellRate: r.newSellRate.toString(),
        actorId: r.actorId?.toString() ?? null,
        reason: r.reason,
        createdAt: r.createdAt,
      })),
      total,
      page,
      pageSize,
    };
  }

  private toRateView(r: {
    currency: string;
    buyRate: Prisma.Decimal;
    sellRate: Prisma.Decimal;
    updatedAt?: Date;
  }) {
    return {
      currency: r.currency,
      /** 1 CNY = N 该币种 */
      cnyToFiat: r.buyRate.toString(),
      sellRate: r.sellRate.toString(),
      /** 兼容旧字段 */
      buyRate: r.buyRate.toString(),
      updatedAt: r.updatedAt,
    };
  }
}

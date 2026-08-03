import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ok } from '../common/response';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ExchangeService } from './exchange.service';
import { PackagesService } from '../packages/packages.service';
import { VipPlansService } from '../vip/vip-plans.service';

class QuoteDto {
  @IsNotEmpty()
  @IsString()
  currency!: string;

  @IsNotEmpty()
  basePrice!: number | string;
}

@Controller('v1')
export class ExchangeController {
  constructor(
    private readonly exchange: ExchangeService,
    private readonly packages: PackagesService,
    private readonly vipPlans: VipPlansService,
  ) {}

  /** 法币相对 CNY 汇率（cnyToFiat） */
  @Get('exchange-rates')
  async rates() {
    return ok(await this.exchange.getRates());
  }

  /** 公开：启用中的积分套餐 + 指定币种应付金额 */
  @Get('topup-packages')
  async topupPackages(@Query('currency') currency?: string) {
    return ok(await this.packages.listPublic(currency || 'CNY'));
  }

  /** 公开：启用中的 VIP 套餐 + 指定币种应付金额 */
  @Get('vip-plans')
  async vipPlansList(@Query('currency') currency?: string) {
    return ok(await this.vipPlans.listPublic(currency || 'CNY'));
  }

  /** 报价试算：人民币基准价 → 某法币应付 */
  @Post('exchange-rates/quote')
  async quote(@Body() dto: QuoteDto) {
    const q = await this.exchange.quoteBasePrice(dto.basePrice, dto.currency);
    return ok(q);
  }
}

import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ok } from '../common/response';
import { IsNotEmpty, IsString } from 'class-validator';
import { ExchangeService } from './exchange.service';
import { PackagesService } from '../packages/packages.service';
import { VipPlansService } from '../vip/vip-plans.service';
import { resolveAcceptLanguage } from '../common/i18n/locale';

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

  /** @deprecated 定价已改为直接 USD，汇率仅保留管理/兼容 */
  @Get('exchange-rates')
  async rates() {
    return ok(await this.exchange.getRates());
  }

  /** 公开：启用中的积分套餐（USD） */
  @Get('topup-packages')
  async topupPackages(@Query('currency') _currency?: string) {
    return ok(await this.packages.listPublic('USD'));
  }

  /** 公开：启用中的 VIP 套餐（USD） */
  @Get('vip-plans')
  async vipPlansList(@Req() req: any, @Query('currency') _currency?: string) {
    const locale = resolveAcceptLanguage(req.headers?.['accept-language']);
    return ok(await this.vipPlans.listPublic('USD', locale));
  }

  /** @deprecated 定价已改为直接 USD，无折算 */
  @Post('exchange-rates/quote')
  async quote(@Body() dto: QuoteDto) {
    const q = await this.exchange.quoteBasePrice(dto.basePrice, 'USD');
    return ok(q);
  }
}

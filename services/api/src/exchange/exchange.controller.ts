import { Controller, Get, Query, Req } from '@nestjs/common';
import { ok } from '../common/response';
import { PackagesService } from '../packages/packages.service';
import { VipPlansService } from '../vip/vip-plans.service';
import { resolveAcceptLanguage } from '../common/i18n/locale';

@Controller('v1')
export class ExchangeController {
  constructor(
    private readonly packages: PackagesService,
    private readonly vipPlans: VipPlansService,
  ) {}

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
}

import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';
import { ok } from '../common/response';
import { IsNotEmpty, IsString } from 'class-validator';
import { BizException, BizCode } from '../common/biz.exception';

class SimulateDto {
  @IsNotEmpty()
  @IsString()
  orderNo!: string;
}

@Controller('v1')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('payment-methods')
  async methods(@Query('region') region?: string) {
    return ok(this.payments.getPaymentMethods(region || 'VN'));
  }

  // 开发态：模拟渠道支付成功。生产禁用。
  @Post('payments/simulate')
  async simulate(@Body() dto: SimulateDto) {
    if (process.env.NODE_ENV === 'production') {
      throw new BizException(BizCode.FORBIDDEN, 'Simulate disabled');
    }
    return ok(await this.payments.simulate(dto.orderNo));
  }

  /**
   * 通用 Webhook 入口。
   * Stripe：优先用 Stripe-Signature + raw body 验签，并尊重管理端网关 enabled/事件配置。
   * 其他渠道：x-webhook-secret / 共享 WEBHOOK_SECRET。
   */
  @Post('webhooks/:provider')
  @Throttle({ webhook: { limit: 30, ttl: 60_000 } })
  async webhook(
    @Param('provider') provider: string,
    @Body() payload: any,
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-webhook-secret') webhookSecret?: string,
    @Headers('stripe-signature') stripeSignature?: string,
  ) {
    return ok(
      await this.payments.handleWebhook(provider, payload, {
        webhookSecret,
        stripeSignature,
        rawBody: req.rawBody,
      }),
    );
  }
}

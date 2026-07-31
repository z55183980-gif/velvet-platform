import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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
   * 通用 Webhook 入口。生产部署时请根据渠道（alipay / wechat / stripe …）
   * 实现各自的签名校验与字段解析，统一走 `handleWebhook(provider, payload)`。
   * 开源版仅保留抽象骨架，所有渠道共用共享密钥校验（见 assertWebhookAuth）。
   */
  @Post('webhooks/:provider')
  @Throttle({ webhook: { limit: 30, ttl: 60_000 } })
  async webhook(
    @Param('provider') provider: string,
    @Body() payload: any,
    @Headers('x-webhook-secret') webhookSecret?: string,
    @Headers('stripe-signature') stripeSignature?: string,
  ) {
    const secret = webhookSecret || stripeSignature;
    this.payments.assertWebhookAuth(provider, secret);
    return ok(await this.payments.handleWebhook(provider, payload));
  }
}

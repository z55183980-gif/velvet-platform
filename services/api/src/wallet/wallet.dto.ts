import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

const PAYMENT_METHODS = [
  'WALLET',
  'STRIPE',
  'WECHAT',
  'ALIPAY',
  'MOMO',
  'ZALOPAY',
  'VIETQR',
  'BANK_TRANSFER',
];

export class TopupOrderDto {
  /** 积分套餐 ID */
  @IsNotEmpty()
  packageId!: number | string;

  /** @deprecated 支付固定 USD，此字段忽略 */
  @IsOptional()
  @IsString()
  currency?: string = 'USD';

  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: string = 'STRIPE';

  /** When false, skip Stripe Checkout (dev simulate). Default true for STRIPE. */
  @IsOptional()
  @IsBoolean()
  createCheckout?: boolean;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class VipSubOrderDto {
  @IsNotEmpty()
  vipPlanId!: number | string;

  /** @deprecated 支付固定 USD，此字段忽略 */
  @IsOptional()
  @IsString()
  currency?: string = 'USD';

  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: string = 'STRIPE';

  @IsOptional()
  @IsBoolean()
  createCheckout?: boolean;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class UnlockEpisodeDto {
  @IsNotEmpty()
  episodeId!: number | string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class UnlockDramaDto {
  @IsNotEmpty()
  dramaId!: number | string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class RedeemCodeDto {
  @IsNotEmpty()
  @IsString()
  code!: string;
}

export class RefundDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

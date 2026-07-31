import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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

  /** 支付币种：VND | CNY（支付宝仅 CNY） */
  @IsNotEmpty()
  @IsString()
  currency!: string;

  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: string = 'STRIPE';

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

export class RefundDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

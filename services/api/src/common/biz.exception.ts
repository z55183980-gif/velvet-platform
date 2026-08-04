import { HttpException, HttpStatus } from '@nestjs/common';
import type { MessageKey } from './i18n/messages';
import type { MessageParams } from './i18n/translate';

function defaultHttpStatus(bizCode: number): HttpStatus {
  if (bizCode === 401) return HttpStatus.UNAUTHORIZED;
  if (bizCode === 403) return HttpStatus.FORBIDDEN;
  if (bizCode === 404) return HttpStatus.NOT_FOUND;
  if (bizCode === 409) return HttpStatus.CONFLICT;
  if (bizCode === 402) return HttpStatus.PAYMENT_REQUIRED;
  if (bizCode >= 400 && bizCode < 500) return HttpStatus.BAD_REQUEST;
  return HttpStatus.BAD_REQUEST;
}

/**
 * Business exception: biz code + message.
 * Prefer catalog keys (auth.*, common.*) so AllExceptionsFilter can localize via Accept-Language.
 * Raw English strings are fine for non-i18n paths; Vietnamese literals are deprecated.
 */
export class BizException extends HttpException {
  public readonly messageParams?: MessageParams;

  constructor(
    public readonly bizCode: number,
    message: string | MessageKey,
    httpStatus: HttpStatus = defaultHttpStatus(bizCode),
    messageParams?: MessageParams,
  ) {
    super(message, httpStatus);
    this.messageParams = messageParams;
  }
}

// Common business codes
export const BizCode = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INSUFFICIENT_BALANCE: 4100,
  ALREADY_UNLOCKED: 4101,
  ORDER_NOT_PAID: 4102,
  INVALID_OTP: 4200,
  OTP_EXPIRED: 4201,
  OTP_LOCKED: 4202,
};

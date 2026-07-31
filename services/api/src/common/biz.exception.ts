import { HttpException, HttpStatus } from '@nestjs/common';

function defaultHttpStatus(bizCode: number): HttpStatus {
  if (bizCode === 401) return HttpStatus.UNAUTHORIZED;
  if (bizCode === 403) return HttpStatus.FORBIDDEN;
  if (bizCode === 404) return HttpStatus.NOT_FOUND;
  if (bizCode === 409) return HttpStatus.CONFLICT;
  if (bizCode === 402) return HttpStatus.PAYMENT_REQUIRED;
  if (bizCode >= 400 && bizCode < 500) return HttpStatus.BAD_REQUEST;
  return HttpStatus.BAD_REQUEST;
}

/** 业务异常：携带业务码 code + HTTP 状态码，由 AllExceptionsFilter 统一包装成 { code, message, data } */
export class BizException extends HttpException {
  constructor(
    public readonly bizCode: number,
    message: string,
    httpStatus: HttpStatus = defaultHttpStatus(bizCode),
  ) {
    super(message, httpStatus);
  }
}

// 常用业务码
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

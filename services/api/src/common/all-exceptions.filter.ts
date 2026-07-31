import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { BizException } from './biz.exception';
import { ApiResult } from './response';
import { mapPrismaError } from './prisma-error.util';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let code = -1;
    let message = 'Internal server error';
    let status = HttpStatus.INTERNAL_SERVER_ERROR;

    // Prisma 原始错误 → BizException，避免堆栈/字段细节泄露
    if (
      exception instanceof Prisma.PrismaClientKnownRequestError ||
      exception instanceof Prisma.PrismaClientValidationError
    ) {
      try {
        mapPrismaError(exception);
      } catch (mapped) {
        exception = mapped;
      }
    }

    if (exception instanceof BizException) {
      code = exception.bizCode;
      message = exception.message;
      status = exception.getStatus();
    } else if (exception instanceof HttpException) {
      code = exception.getStatus();
      const resp = exception.getResponse();
      if (typeof resp === 'string') {
        message = resp;
      } else {
        const m = (resp as any).message;
        message = Array.isArray(m) ? m.join(', ') : m ?? exception.message;
      }
      status = exception.getStatus();
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
      message =
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : exception.message;
    }

    const body: ApiResult<null> = { code, message, data: null };
    res.status(status).json(body);
  }
}

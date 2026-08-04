import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { BizException } from './biz.exception';
import { ApiResult } from './response';
import { mapPrismaError } from './prisma-error.util';
import { localizeMessage, localeFromRequest, t } from './i18n/translate';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const acceptLanguage = req?.headers?.['accept-language'];
    const locale = localeFromRequest(req?.headers || {});

    let code = -1;
    let message = t('common.internalError', locale);
    let status = HttpStatus.INTERNAL_SERVER_ERROR;

    // Prisma → BizException (hide stack / field details)
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
      message = localizeMessage(exception.message, acceptLanguage, exception.messageParams);
      status = exception.getStatus();
    } else if (exception instanceof HttpException) {
      code = exception.getStatus();
      const resp = exception.getResponse();
      if (typeof resp === 'string') {
        message = localizeMessage(resp, acceptLanguage);
      } else {
        const m = (resp as { message?: unknown }).message;
        if (Array.isArray(m)) {
          message = m
            .map((item) =>
              typeof item === 'string' ? localizeMessage(item, acceptLanguage) : String(item),
            )
            .join(', ');
        } else if (typeof m === 'string') {
          message = localizeMessage(m, acceptLanguage);
        } else {
          message = localizeMessage(exception.message, acceptLanguage);
        }
      }
      status = exception.getStatus();
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
      message =
        process.env.NODE_ENV === 'production'
          ? t('common.internalError', locale)
          : exception.message;
    }

    const body: ApiResult<null> = { code, message, data: null };
    res.status(status).json(body);
  }
}

import { Prisma } from '@prisma/client';
import { BizException, BizCode } from './biz.exception';

/** 将 Prisma 已知错误翻译为 BizException，避免堆栈/字段细节泄露给前端 */
export function mapPrismaError(e: unknown): never {
  if (e instanceof BizException) throw e;

  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    switch (e.code) {
      case 'P2002': {
        const target = (e.meta?.target as string[] | string | undefined) || '';
        const field = Array.isArray(target) ? target.join(',') : String(target || '');
        if (field) {
          throw new BizException(BizCode.CONFLICT, 'common.recordExistsField', undefined, {
            field,
          });
        }
        throw new BizException(BizCode.CONFLICT, 'common.recordExists');
      }
      case 'P2003':
        throw new BizException(BizCode.BAD_REQUEST, 'common.invalidReference');
      case 'P2025':
        throw new BizException(BizCode.NOT_FOUND, 'common.recordNotFound');
      default:
        throw new BizException(BizCode.BAD_REQUEST, 'common.dataOpFailed');
    }
  }

  if (e instanceof Prisma.PrismaClientValidationError) {
    const msg = e.message || '';
    const missing = msg.match(/Argument `(\w+)` is missing/);
    if (missing) {
      throw new BizException(BizCode.BAD_REQUEST, 'common.missingField', undefined, {
        field: missing[1],
      });
    }
    throw new BizException(BizCode.BAD_REQUEST, 'common.invalidData');
  }

  throw e;
}

export function withPrismaGuard<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((e) => mapPrismaError(e));
}

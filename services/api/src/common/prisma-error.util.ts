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
        throw new BizException(
          BizCode.CONFLICT,
          field ? `Dữ liệu đã tồn tại (${field})` : 'Dữ liệu đã tồn tại',
        );
      }
      case 'P2003':
        throw new BizException(BizCode.BAD_REQUEST, 'Tham chiếu không hợp lệ');
      case 'P2025':
        throw new BizException(BizCode.NOT_FOUND, 'Không tìm thấy bản ghi');
      default:
        throw new BizException(BizCode.BAD_REQUEST, 'Thao tác dữ liệu thất bại');
    }
  }

  if (e instanceof Prisma.PrismaClientValidationError) {
    const msg = e.message || '';
    const missing = msg.match(/Argument `(\w+)` is missing/);
    if (missing) {
      throw new BizException(BizCode.BAD_REQUEST, `缺少必要字段 ${missing[1]}`);
    }
    throw new BizException(BizCode.BAD_REQUEST, 'Dữ liệu không hợp lệ');
  }

  throw e;
}

export function withPrismaGuard<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((e) => mapPrismaError(e));
}

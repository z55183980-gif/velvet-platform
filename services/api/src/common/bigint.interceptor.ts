import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Prisma } from '@prisma/client';

/**
 * 全局拦截器：把响应中的所有 BigInt / Prisma.Decimal 序列化为字符串，
 * 避免 JSON 精度丢失（见 00 §八 / 03 §5.1）。
 */
@Injectable()
export class BigIntInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => this.transform(data)));
  }

  private transform(value: any): any {
    if (value === null || value === undefined) return value;
    if (value instanceof StreamableFile) return value;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return value;
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Prisma.Decimal) return value.toString();
    if (Array.isArray(value)) return value.map((v) => this.transform(v));
    if (typeof value === 'object') {
      // 避免把 StreamableFile / 特殊对象拆成 plain object
      if (value.constructor && value.constructor !== Object && !(value instanceof Date)) {
        return value;
      }
      const out: Record<string, any> = {};
      for (const key of Object.keys(value)) {
        out[key] = this.transform(value[key]);
      }
      return out;
    }
    return value;
  }
}

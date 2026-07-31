import { Prisma } from '@prisma/client';

/** 任意数值输入 → BigInt（VND 整数）。Number 在 9e15 内精度安全。 */
export function toBigInt(v: number | string | bigint): bigint {
  if (typeof v === 'bigint') return v;
  return BigInt(Math.trunc(Number(v)));
}

/** 生成可读且唯一的订单号：前缀 + 时间36进制 + 随机 */
export function genOrderNo(prefix: string): string {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}${t}${r}`;
}

export function toDecimal(v: number | string): Prisma.Decimal {
  return new Prisma.Decimal(v);
}

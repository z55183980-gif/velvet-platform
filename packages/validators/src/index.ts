import { z } from "zod";

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const walletAdjustSchema = z.object({
  deltaCredits: z.coerce.number().int(),
  reason: z.string().min(1),
  remark: z.string().optional(),
});

export const exchangeRateSchema = z.object({
  currency: z.string().min(1).max(8),
  cnyToFiat: z.coerce.number().positive(),
  sellRate: z.coerce.number().positive().optional(),
});

export const vipPlanSchema = z.object({
  nameEn: z.string().trim().min(1),
  nameZh: z.string().optional(),
  nameFr: z.string().optional(),
  durationDays: z.coerce.number().int().positive(),
  basePrice: z.coerce.number().positive(),
  sortOrder: z.coerce.number().int().optional(),
  badge: z.string().optional(),
  active: z.boolean().optional(),
});

export const redeemBatchSchema = z.object({
  name: z.string().optional(),
  type: z.enum(["VIP", "CREDITS"]),
  vipDays: z.coerce.number().int().positive().optional(),
  creditsAmount: z.coerce.number().int().positive().optional(),
  quantity: z.coerce.number().int().positive(),
  expiresAt: z.string().optional(),
  note: z.string().optional(),
});

export const reasonSchema = z.object({
  reason: z.string().min(1),
});

export type PaginationInput = z.infer<typeof paginationSchema>;
export type WalletAdjustInput = z.infer<typeof walletAdjustSchema>;
export type ExchangeRateInput = z.infer<typeof exchangeRateSchema>;
export type VipPlanInput = z.infer<typeof vipPlanSchema>;
export type RedeemBatchInput = z.infer<typeof redeemBatchSchema>;

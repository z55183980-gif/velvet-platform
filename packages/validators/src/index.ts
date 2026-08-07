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

export const vipPlanSchema = z.object({
  nameEn: z.string().trim().min(1),
  nameZh: z.string().optional(),
  nameFr: z.string().optional(),
  durationDays: z.coerce.number().int().positive(),
  basePrice: z.coerce.number().positive(),
  originalPrice: z.preprocess(
    (v) => (v === '' || v == null ? undefined : v),
    z.coerce.number().positive().optional(),
  ),
  sortOrder: z.coerce.number().int().optional(),
  badge: z.string().optional(),
  descEn: z.string().trim().min(1),
  descZh: z.string().optional(),
  descFr: z.string().optional(),
  benefits: z.union([
    z.array(z.string().trim().min(1)).min(1),
    z
      .string()
      .trim()
      .min(1)
      .transform((s) =>
        s
          .split(/\n|,/)
          .map((x) => x.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.string().min(1)).min(1)),
  ]),
  active: z.boolean().optional(),
});

export const topupPackageSchema = z.object({
  name: z.string().trim().optional(),
  baseCredits: z.coerce.number().int().positive(),
  bonusCredits: z.coerce.number().int().min(0).optional(),
  basePrice: z.coerce.number().positive(),
  sortOrder: z.coerce.number().int().optional(),
  badge: z.string().optional(),
  active: z.boolean().optional(),
});

export const redeemBatchSchema = z
  .object({
    name: z.string().max(120).optional(),
    type: z.enum(["VIP", "CREDITS"]),
    vipDays: z.coerce.number().int().positive().max(3650).optional(),
    creditsAmount: z.coerce.number().int().positive().max(10_000_000).optional(),
    quantity: z.coerce.number().int().positive().max(5000),
    expiresAt: z.string().optional(),
    note: z.string().max(500).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.type === "VIP" && !(val.vipDays && val.vipDays > 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "vipDays required", path: ["vipDays"] });
    }
    if (val.type === "CREDITS" && !(val.creditsAmount && val.creditsAmount > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "creditsAmount required",
        path: ["creditsAmount"],
      });
    }
    if (val.expiresAt) {
      const d = new Date(val.expiresAt);
      if (Number.isNaN(d.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "expiresAt invalid", path: ["expiresAt"] });
      }
    }
  });

export const reasonSchema = z.object({
  reason: z.string().min(1),
});

export type PaginationInput = z.infer<typeof paginationSchema>;
export type WalletAdjustInput = z.infer<typeof walletAdjustSchema>;
export type VipPlanInput = z.infer<typeof vipPlanSchema>;
export type TopupPackageInput = z.infer<typeof topupPackageSchema>;
export type RedeemBatchInput = z.infer<typeof redeemBatchSchema>;

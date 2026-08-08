-- VIP is Stripe Checkout mode=payment (one-time). Align copy + DB default.
ALTER TABLE "vip_plans"
  ALTER COLUMN "descEn" SET DEFAULT 'One-time purchase. No auto-renewal.';

UPDATE "vip_plans"
SET
  "descEn" = CASE "durationDays"
    WHEN 7 THEN 'One-time purchase for 7 days of VIP. No auto-renewal.'
    WHEN 30 THEN 'One-time purchase for 30 days of VIP. No auto-renewal.'
    WHEN 90 THEN 'One-time purchase for 90 days of VIP. No auto-renewal.'
    WHEN 365 THEN 'One-time purchase for 365 days of VIP. No auto-renewal.'
    ELSE 'One-time purchase. No auto-renewal.'
  END,
  "descZh" = CASE "durationDays"
    WHEN 7 THEN '一次性购买，开通 7 天 VIP。不会自动续费。'
    WHEN 30 THEN '一次性购买，开通 30 天 VIP。不会自动续费。'
    WHEN 90 THEN '一次性购买，开通 90 天 VIP。不会自动续费。'
    WHEN 365 THEN '一次性购买，开通 365 天 VIP。不会自动续费。'
    ELSE '一次性购买，按套餐天数开通 VIP。不会自动续费。'
  END
WHERE
  "descEn" ILIKE '%auto-renew%'
  OR "descEn" ILIKE '%cancel anytime%'
  OR "descEn" ILIKE '%first week%'
  OR "descEn" ILIKE '%then %/week%'
  OR "descEn" ILIKE '%随时取消%'
  OR "descEn" ILIKE '%自动续费%';

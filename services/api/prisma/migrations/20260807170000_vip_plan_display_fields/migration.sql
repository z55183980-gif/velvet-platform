-- VIP plans: original price, marketing description, benefits
ALTER TABLE "vip_plans" ADD COLUMN IF NOT EXISTS "originalPrice" DECIMAL(18,2);
ALTER TABLE "vip_plans" ADD COLUMN IF NOT EXISTS "descEn" TEXT;
ALTER TABLE "vip_plans" ADD COLUMN IF NOT EXISTS "descZh" TEXT;
ALTER TABLE "vip_plans" ADD COLUMN IF NOT EXISTS "descFr" TEXT;
ALTER TABLE "vip_plans" ADD COLUMN IF NOT EXISTS "benefits" JSONB;

UPDATE "vip_plans"
SET "descEn" = COALESCE(NULLIF(TRIM("descEn"), ''), 'Auto-renew. Cancel anytime.')
WHERE "descEn" IS NULL OR TRIM("descEn") = '';

UPDATE "vip_plans"
SET "benefits" = '["Unlimited Viewing", "1080p High Quality"]'::jsonb
WHERE "benefits" IS NULL;

ALTER TABLE "vip_plans" ALTER COLUMN "descEn" SET DEFAULT 'Auto-renew. Cancel anytime.';
ALTER TABLE "vip_plans" ALTER COLUMN "descEn" SET NOT NULL;
ALTER TABLE "vip_plans" ALTER COLUMN "benefits" SET DEFAULT '["Unlimited Viewing", "1080p High Quality"]'::jsonb;
ALTER TABLE "vip_plans" ALTER COLUMN "benefits" SET NOT NULL;

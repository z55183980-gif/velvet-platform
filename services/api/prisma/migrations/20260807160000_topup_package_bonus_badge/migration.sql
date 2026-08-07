-- Topup packages: split immediate / bonus credits + optional badge
ALTER TABLE "topup_packages" ADD COLUMN IF NOT EXISTS "baseCredits" BIGINT;
ALTER TABLE "topup_packages" ADD COLUMN IF NOT EXISTS "bonusCredits" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "topup_packages" ADD COLUMN IF NOT EXISTS "badge" TEXT;

-- Backfill: existing packages treat total credits as immediate grant
UPDATE "topup_packages"
SET "baseCredits" = "credits"
WHERE "baseCredits" IS NULL;

ALTER TABLE "topup_packages" ALTER COLUMN "baseCredits" SET NOT NULL;

-- CreateTable
CREATE TABLE IF NOT EXISTS "topup_packages" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT,
    "credits" BIGINT NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'CNY',
    "basePrice" DECIMAL(18,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topup_packages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "topup_packages_active_sortOrder_idx" ON "topup_packages"("active", "sortOrder");

-- AlterTable: orders.packageId
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "packageId" BIGINT;

CREATE INDEX IF NOT EXISTS "orders_packageId_idx" ON "orders"("packageId");

DO $$ BEGIN
  ALTER TABLE "orders" ADD CONSTRAINT "orders_packageId_fkey"
    FOREIGN KEY ("packageId") REFERENCES "topup_packages"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 汇率语义迁移：buyRate = cnyToFiat（1 CNY = N 该币）
UPDATE "credit_exchange_rates" SET "buyRate" = 1, "sellRate" = 1 WHERE "currency" = 'CNY';
UPDATE "credit_exchange_rates" SET "buyRate" = 3500, "sellRate" = 3500 WHERE "currency" = 'VND';

-- 种子套餐（若表空）
INSERT INTO "topup_packages" ("name", "credits", "baseCurrency", "basePrice", "sortOrder", "active", "updatedAt")
SELECT * FROM (VALUES
  ('入门', 10::bigint, 'CNY', 10.00::decimal, 10, true, CURRENT_TIMESTAMP),
  ('常用', 50::bigint, 'CNY', 50.00::decimal, 20, true, CURRENT_TIMESTAMP),
  ('超值', 100::bigint, 'CNY', 90.00::decimal, 30, true, CURRENT_TIMESTAMP)
) AS v(name, credits, "baseCurrency", "basePrice", "sortOrder", active, "updatedAt")
WHERE NOT EXISTS (SELECT 1 FROM "topup_packages" LIMIT 1);

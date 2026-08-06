-- Fix: vip_plans was referenced by later migrations (usd_pricing, vip_plan_names_en, ...)
-- but never had a CREATE TABLE migration of its own — it only ever existed via `prisma db push`.
-- Same for orders.vipPlanId.
-- CreateTable
CREATE TABLE IF NOT EXISTS "vip_plans" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT,
    "durationDays" INTEGER NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'CNY',
    "basePrice" DECIMAL(18,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "badge" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vip_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "vip_plans_active_sortOrder_idx" ON "vip_plans"("active", "sortOrder");

-- AlterTable: orders.vipPlanId
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "vipPlanId" BIGINT;

CREATE INDEX IF NOT EXISTS "orders_vipPlanId_idx" ON "orders"("vipPlanId");

DO $$ BEGIN
  ALTER TABLE "orders" ADD CONSTRAINT "orders_vipPlanId_fkey"
    FOREIGN KEY ("vipPlanId") REFERENCES "vip_plans"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

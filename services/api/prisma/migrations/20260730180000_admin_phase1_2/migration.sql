-- Admin Phase 1+2 additive columns (already applied via db push in some envs)
ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'SUPER_ADMIN';
ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);

ALTER TABLE "dramas" ADD COLUMN IF NOT EXISTS "sortWeight" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "refundReason" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "refundStatus" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "refundNote" TEXT;

-- Forward reconciliation: objects that existed in production via `db push` / manual edits
-- but were never represented in the migration chain. Idempotent for upgrade + empty DB.

-- OrderType: VIP / drama buyout
ALTER TYPE "OrderType" ADD VALUE IF NOT EXISTS 'VIP_SUB';
ALTER TYPE "OrderType" ADD VALUE IF NOT EXISTS 'DRAMA_BUYOUT';

-- users.vipExpireAt
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "vipExpireAt" TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS "users_vipExpireAt_idx" ON "users"("vipExpireAt");

-- dramas.buyoutCredits + timestamp type alignment
ALTER TABLE "dramas" ADD COLUMN IF NOT EXISTS "buyoutCredits" BIGINT;
ALTER TABLE "dramas" ALTER COLUMN "rightsVerifiedAt" SET DATA TYPE TIMESTAMP(3);
ALTER TABLE "dramas" ALTER COLUMN "takedownAt" SET DATA TYPE TIMESTAMP(3);

-- episodes.priceCredits + timestamp type alignment
ALTER TABLE "episodes" ADD COLUMN IF NOT EXISTS "priceCredits" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "episodes" ALTER COLUMN "resolvedAt" SET DATA TYPE TIMESTAMP(3);
ALTER TABLE "episodes" ALTER COLUMN "resolvedExpiresAt" SET DATA TYPE TIMESTAMP(3);

-- orders credits / settle / meta
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "amountCredits" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "earningSettled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "meta" JSONB;
CREATE INDEX IF NOT EXISTS "orders_orderType_paymentStatus_createdAt_idx"
  ON "orders"("orderType", "paymentStatus", "createdAt");

-- wallets: VND -> credits (rename when old cols present; add when missing)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wallets' AND column_name = 'balanceVnd'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wallets' AND column_name = 'balanceCredits'
  ) THEN
    ALTER TABLE "wallets" RENAME COLUMN "balanceVnd" TO "balanceCredits";
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wallets' AND column_name = 'balanceCredits'
  ) THEN
    ALTER TABLE "wallets" ADD COLUMN "balanceCredits" BIGINT NOT NULL DEFAULT 0;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wallets' AND column_name = 'totalRecharged'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wallets' AND column_name = 'totalRechargedCredits'
  ) THEN
    ALTER TABLE "wallets" RENAME COLUMN "totalRecharged" TO "totalRechargedCredits";
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wallets' AND column_name = 'totalRechargedCredits'
  ) THEN
    ALTER TABLE "wallets" ADD COLUMN "totalRechargedCredits" BIGINT NOT NULL DEFAULT 0;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wallets' AND column_name = 'totalSpent'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wallets' AND column_name = 'totalSpentCredits'
  ) THEN
    ALTER TABLE "wallets" RENAME COLUMN "totalSpent" TO "totalSpentCredits";
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wallets' AND column_name = 'totalSpentCredits'
  ) THEN
    ALTER TABLE "wallets" ADD COLUMN "totalSpentCredits" BIGINT NOT NULL DEFAULT 0;
  END IF;

  -- Leftover legacy columns if both old+new somehow exist
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wallets' AND column_name = 'balanceVnd'
  ) THEN
    ALTER TABLE "wallets" DROP COLUMN "balanceVnd";
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wallets' AND column_name = 'totalRecharged'
  ) THEN
    ALTER TABLE "wallets" DROP COLUMN "totalRecharged";
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wallets' AND column_name = 'totalSpent'
  ) THEN
    ALTER TABLE "wallets" DROP COLUMN "totalSpent";
  END IF;
END $$;

-- wallet_transactions: amountVnd -> amountCredits
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wallet_transactions' AND column_name = 'amountVnd'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wallet_transactions' AND column_name = 'amountCredits'
  ) THEN
    ALTER TABLE "wallet_transactions" RENAME COLUMN "amountVnd" TO "amountCredits";
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wallet_transactions' AND column_name = 'amountCredits'
  ) THEN
    ALTER TABLE "wallet_transactions" ADD COLUMN "amountCredits" BIGINT NOT NULL DEFAULT 0;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wallet_transactions' AND column_name = 'amountVnd'
  ) THEN
    ALTER TABLE "wallet_transactions" DROP COLUMN "amountVnd";
  END IF;
END $$;

-- Schema default (rename path does not inherit @default(0))
ALTER TABLE "wallet_transactions" ALTER COLUMN "amountCredits" SET DEFAULT 0;

-- Whole-drama buyout unlocks
CREATE TABLE IF NOT EXISTS "user_drama_unlocks" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "dramaId" BIGINT NOT NULL,
    "orderId" BIGINT,
    "unlockedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_drama_unlocks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "user_drama_unlocks_userId_unlockedAt_idx"
  ON "user_drama_unlocks"("userId", "unlockedAt" DESC);
CREATE INDEX IF NOT EXISTS "user_drama_unlocks_dramaId_idx"
  ON "user_drama_unlocks"("dramaId");
CREATE UNIQUE INDEX IF NOT EXISTS "user_drama_unlocks_userId_dramaId_key"
  ON "user_drama_unlocks"("userId", "dramaId");

DO $$ BEGIN
  ALTER TABLE "user_drama_unlocks" ADD CONSTRAINT "user_drama_unlocks_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "user_drama_unlocks" ADD CONSTRAINT "user_drama_unlocks_dramaId_fkey"
    FOREIGN KEY ("dramaId") REFERENCES "dramas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "user_drama_unlocks" ADD CONSTRAINT "user_drama_unlocks_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- redeem_codes.code_hint nullability/default (hash migration left them nullable)
UPDATE "redeem_codes" SET "code_hint" = '' WHERE "code_hint" IS NULL;
ALTER TABLE "redeem_codes" ALTER COLUMN "code_hint" SET DEFAULT '';
ALTER TABLE "redeem_codes" ALTER COLUMN "code_hint" SET NOT NULL;

-- Timestamp(3) alignment for tables that init/created as timestamptz or with defaults
ALTER TABLE "admin_users" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "admin_users" ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

ALTER TABLE "media_transcode_jobs" ALTER COLUMN "startedAt" SET DATA TYPE TIMESTAMP(3);
ALTER TABLE "media_transcode_jobs" ALTER COLUMN "finishedAt" SET DATA TYPE TIMESTAMP(3);
ALTER TABLE "media_transcode_jobs" ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

ALTER TABLE "ytdlp_transfer_jobs" ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- Favorites index name from gap_round3 -> Prisma default
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'i' AND c.relname = 'favorites_user_id_group_idx' AND n.nspname = 'public'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'i' AND c.relname = 'favorites_userId_group_idx' AND n.nspname = 'public'
  ) THEN
    ALTER INDEX "favorites_user_id_group_idx" RENAME TO "favorites_userId_group_idx";
  END IF;
END $$;

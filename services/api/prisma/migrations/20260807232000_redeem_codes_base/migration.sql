-- Base redeem-code tables that historically only existed via `prisma db push`.
-- Must run BEFORE 20260807233000_redeem_code_hash (which ALTERs redeem_codes).
-- Idempotent for production DBs that already have these objects.

DO $$ BEGIN
  CREATE TYPE "RedeemCodeType" AS ENUM ('VIP', 'CREDITS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RedeemCodeStatus" AS ENUM ('UNUSED', 'USED', 'VOID');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "redeem_code_batches" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT,
    "type" "RedeemCodeType" NOT NULL,
    "vipDays" INTEGER,
    "creditsAmount" BIGINT,
    "quantity" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ,
    "createdByAdminId" BIGINT,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "redeem_code_batches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "redeem_code_batches_createdAt_idx"
  ON "redeem_code_batches"("createdAt" DESC);

-- Pre-hash shape includes plaintext "code"; hash migration moves it to code_legacy/code_hash.
CREATE TABLE IF NOT EXISTS "redeem_codes" (
    "id" BIGSERIAL NOT NULL,
    "batchId" BIGINT NOT NULL,
    "code" TEXT,
    "type" "RedeemCodeType" NOT NULL,
    "vipDays" INTEGER,
    "creditsAmount" BIGINT,
    "status" "RedeemCodeStatus" NOT NULL DEFAULT 'UNUSED',
    "usedByUserId" BIGINT,
    "usedAt" TIMESTAMPTZ,
    "expiresAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "redeem_codes_pkey" PRIMARY KEY ("id")
);

-- Only create unique(code) when the legacy column still exists (fresh empty DB).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'redeem_codes' AND column_name = 'code'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS "redeem_codes_code_key" ON "redeem_codes"("code")';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "redeem_codes_batchId_status_idx"
  ON "redeem_codes"("batchId", "status");
CREATE INDEX IF NOT EXISTS "redeem_codes_status_expiresAt_idx"
  ON "redeem_codes"("status", "expiresAt");

DO $$ BEGIN
  ALTER TABLE "redeem_codes" ADD CONSTRAINT "redeem_codes_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "redeem_code_batches"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "redeem_codes" ADD CONSTRAINT "redeem_codes_usedByUserId_fkey"
    FOREIGN KEY ("usedByUserId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "redeem_redemptions" (
    "id" BIGSERIAL NOT NULL,
    "codeId" BIGINT NOT NULL,
    "userId" BIGINT NOT NULL,
    "type" "RedeemCodeType" NOT NULL,
    "vipDays" INTEGER,
    "creditsAmount" BIGINT,
    "vipExpireAt" TIMESTAMPTZ,
    "orderId" BIGINT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "redeem_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "redeem_redemptions_userId_createdAt_idx"
  ON "redeem_redemptions"("userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "redeem_redemptions_codeId_idx"
  ON "redeem_redemptions"("codeId");

DO $$ BEGIN
  ALTER TABLE "redeem_redemptions" ADD CONSTRAINT "redeem_redemptions_codeId_fkey"
    FOREIGN KEY ("codeId") REFERENCES "redeem_codes"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "redeem_redemptions" ADD CONSTRAINT "redeem_redemptions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

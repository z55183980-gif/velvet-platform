-- Redeem codes: store HMAC hash + masked hint; keep legacy plaintext for one-shot backfill.

ALTER TABLE "redeem_codes" ADD COLUMN IF NOT EXISTS "code_hash" TEXT;
ALTER TABLE "redeem_codes" ADD COLUMN IF NOT EXISTS "code_hint" TEXT;
ALTER TABLE "redeem_codes" ADD COLUMN IF NOT EXISTS "code_legacy" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'redeem_codes'
      AND column_name = 'code'
  ) THEN
    EXECUTE 'UPDATE "redeem_codes" SET "code_legacy" = "code" WHERE "code_legacy" IS NULL';
    EXECUTE 'ALTER TABLE "redeem_codes" DROP CONSTRAINT IF EXISTS "redeem_codes_code_key"';
    EXECUTE 'ALTER TABLE "redeem_codes" DROP COLUMN "code"';
  END IF;
END $$;

UPDATE "redeem_codes"
SET "code_hint" = CONCAT('****-****-****-', RIGHT(REPLACE(COALESCE("code_legacy", ''), '-', ''), 4))
WHERE ("code_hint" IS NULL OR "code_hint" = '')
  AND "code_legacy" IS NOT NULL
  AND "code_legacy" <> '';

-- Temporary uniqueness; API startup backfills code_hash from code_legacy, then clears legacy.
CREATE UNIQUE INDEX IF NOT EXISTS "redeem_codes_code_legacy_key" ON "redeem_codes"("code_legacy");
CREATE UNIQUE INDEX IF NOT EXISTS "redeem_codes_code_hash_key" ON "redeem_codes"("code_hash");

-- Allow null hash only until process backfill completes; new inserts always set hash.
ALTER TABLE "redeem_codes" ALTER COLUMN "code_hash" DROP NOT NULL;
ALTER TABLE "redeem_codes" ALTER COLUMN "code_hint" DROP NOT NULL;

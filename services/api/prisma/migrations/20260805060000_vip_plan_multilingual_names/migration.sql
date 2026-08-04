-- Add localized VIP plan names. English is canonical and the fallback for
-- every missing translation. Keep the legacy name column for compatibility.
ALTER TABLE "vip_plans"
  ADD COLUMN "nameEn" TEXT,
  ADD COLUMN "nameZh" TEXT,
  ADD COLUMN "nameFr" TEXT;

UPDATE "vip_plans"
SET "nameEn" = COALESCE(
  NULLIF(BTRIM("name"), ''),
  'VIP ' || "durationDays"::text || ' days'
);

ALTER TABLE "vip_plans" ALTER COLUMN "nameEn" SET NOT NULL;

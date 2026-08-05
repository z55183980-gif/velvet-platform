DO $$
BEGIN
  CREATE TYPE "MediaOrientation" AS ENUM ('LANDSCAPE', 'PORTRAIT', 'SQUARE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "episodes"
  ADD COLUMN IF NOT EXISTS "mediaWidth" INTEGER,
  ADD COLUMN IF NOT EXISTS "mediaHeight" INTEGER,
  ADD COLUMN IF NOT EXISTS "mediaOrientation" "MediaOrientation";

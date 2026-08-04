-- AlterTable
ALTER TABLE "dramas" ADD COLUMN IF NOT EXISTS "externalRef" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "dramas_externalRef_key" ON "dramas"("externalRef");

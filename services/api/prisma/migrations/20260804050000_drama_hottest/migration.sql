-- AlterTable
ALTER TABLE "dramas" ADD COLUMN IF NOT EXISTS "isHottest" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "dramas" ADD COLUMN IF NOT EXISTS "hottestSortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "dramas_isHottest_hottestSortOrder_idx" ON "dramas"("isHottest", "hottestSortOrder");

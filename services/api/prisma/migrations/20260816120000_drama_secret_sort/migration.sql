ALTER TABLE "dramas"
ADD COLUMN "secretSortOrder" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "dramas_isSecret_secretSortOrder_idx"
ON "dramas"("isSecret", "secretSortOrder");

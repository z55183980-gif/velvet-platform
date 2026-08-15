ALTER TABLE "dramas"
ADD COLUMN "isSecret" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "dramas_isSecret_status_publishedAt_idx"
ON "dramas"("isSecret", "status", "publishedAt" DESC);

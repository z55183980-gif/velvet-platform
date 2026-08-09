-- Some push-era DBs are missing the GIN tags index from gap_round3.
-- Declared in schema.prisma as dramas_tags_gin_idx.
CREATE INDEX IF NOT EXISTS "dramas_tags_gin_idx" ON "dramas" USING GIN ("tags");

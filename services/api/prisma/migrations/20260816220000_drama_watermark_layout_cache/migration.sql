ALTER TABLE "dramas"
ADD COLUMN "reelShortWatermarkLayout" JSONB,
ADD COLUMN "reelShortWatermarkResolvedAt" TIMESTAMPTZ;

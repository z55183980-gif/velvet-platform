-- AlterTable
ALTER TABLE "media_transcode_jobs" ADD COLUMN IF NOT EXISTS "watermarkEnabled" BOOLEAN;
ALTER TABLE "media_transcode_jobs" ADD COLUMN IF NOT EXISTS "watermarkX" DOUBLE PRECISION;
ALTER TABLE "media_transcode_jobs" ADD COLUMN IF NOT EXISTS "watermarkY" DOUBLE PRECISION;
ALTER TABLE "media_transcode_jobs" ADD COLUMN IF NOT EXISTS "watermarkScale" DOUBLE PRECISION;

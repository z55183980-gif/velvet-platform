-- Persist yt-dlp transfer orchestration (survive API restart).

CREATE TYPE "YtdlpTransferJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "ytdlp_transfer_jobs" (
  "id" TEXT NOT NULL,
  "dramaId" BIGINT NOT NULL,
  "slug" TEXT NOT NULL,
  "status" "YtdlpTransferJobStatus" NOT NULL DEFAULT 'QUEUED',
  "target" TEXT NOT NULL,
  "preferR2" BOOLEAN NOT NULL DEFAULT false,
  "total" INTEGER NOT NULL,
  "transferred" INTEGER NOT NULL DEFAULT 0,
  "currentEpisode" INTEGER,
  "failedEpisodes" JSONB NOT NULL DEFAULT '[]',
  "jobs" JSONB NOT NULL DEFAULT '[]',
  "payload" JSONB NOT NULL,
  "previewUrl" TEXT,
  "extractor" TEXT,
  "kind" TEXT,
  "externalRef" TEXT,
  "sourceType" TEXT,
  "error" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMPTZ,
  "finishedAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "ytdlp_transfer_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ytdlp_transfer_jobs_status_createdAt_idx"
  ON "ytdlp_transfer_jobs"("status", "createdAt");
CREATE INDEX "ytdlp_transfer_jobs_dramaId_idx"
  ON "ytdlp_transfer_jobs"("dramaId");

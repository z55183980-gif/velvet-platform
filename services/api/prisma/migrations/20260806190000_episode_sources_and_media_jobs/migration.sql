ALTER TABLE "episodes"
  ADD COLUMN "sourcePageUrl" TEXT,
  ADD COLUMN "sourceProvider" TEXT,
  ADD COLUMN "externalVideoId" TEXT,
  ADD COLUMN "playlistIndex" INTEGER,
  ADD COLUMN "resolvedAt" TIMESTAMPTZ,
  ADD COLUMN "resolvedExpiresAt" TIMESTAMPTZ,
  ADD COLUMN "sourceHeaders" JSONB;

CREATE TYPE "ContentLicenseType" AS ENUM (
  'UNKNOWN', 'PUBLIC_DOMAIN', 'CC0', 'CC_BY', 'CC_BY_SA', 'AUTHORIZED', 'OWNED'
);

ALTER TABLE "dramas"
  ADD COLUMN "licenseType" "ContentLicenseType" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "sourcePublisher" TEXT,
  ADD COLUMN "attributionText" TEXT,
  ADD COLUMN "rightsProofUrl" TEXT,
  ADD COLUMN "rightsVerifiedAt" TIMESTAMPTZ,
  ADD COLUMN "takedownAt" TIMESTAMPTZ,
  ADD COLUMN "takedownReason" TEXT;

CREATE INDEX "episodes_sourceProvider_externalVideoId_idx"
  ON "episodes"("sourceProvider", "externalVideoId");

CREATE TYPE "MediaJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "media_transcode_jobs" (
  "id" TEXT NOT NULL,
  "episodeId" BIGINT,
  "inputRel" TEXT NOT NULL,
  "status" "MediaJobStatus" NOT NULL DEFAULT 'QUEUED',
  "outputRel" TEXT,
  "error" TEXT,
  "preferR2" BOOLEAN,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMPTZ,
  "finishedAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "media_transcode_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "media_transcode_jobs_status_createdAt_idx"
  ON "media_transcode_jobs"("status", "createdAt");
CREATE INDEX "media_transcode_jobs_episodeId_idx"
  ON "media_transcode_jobs"("episodeId");

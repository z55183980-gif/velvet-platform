-- Help Center feedback / complaint / suggestion inbox
CREATE TABLE IF NOT EXISTS "feedback_submissions" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT,
    "category" TEXT NOT NULL,
    "contactEmail" TEXT,
    "body" TEXT NOT NULL,
    "locale" VARCHAR(8),
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMPTZ,

    CONSTRAINT "feedback_submissions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "feedback_submissions_status_createdAt_idx"
  ON "feedback_submissions"("status", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "feedback_submissions_createdAt_idx"
  ON "feedback_submissions"("createdAt" DESC);

CREATE INDEX IF NOT EXISTS "feedback_submissions_userId_createdAt_idx"
  ON "feedback_submissions"("userId", "createdAt" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'feedback_submissions_userId_fkey'
  ) THEN
    ALTER TABLE "feedback_submissions"
      ADD CONSTRAINT "feedback_submissions_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

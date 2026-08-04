-- AlterTable
ALTER TABLE "dramas" ADD COLUMN IF NOT EXISTS "likeCount" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE IF NOT EXISTS "likes" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "dramaId" BIGINT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "likes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "likes_userId_dramaId_key" ON "likes"("userId", "dramaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "likes_userId_createdAt_idx" ON "likes"("userId", "createdAt" DESC);

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'likes_userId_fkey'
  ) THEN
    ALTER TABLE "likes" ADD CONSTRAINT "likes_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'likes_dramaId_fkey'
  ) THEN
    ALTER TABLE "likes" ADD CONSTRAINT "likes_dramaId_fkey"
      FOREIGN KEY ("dramaId") REFERENCES "dramas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

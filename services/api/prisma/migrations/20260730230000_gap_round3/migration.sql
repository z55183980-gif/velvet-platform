-- 缺口 6：收藏分组 / 备注（幂等）
ALTER TABLE "favorites" ADD COLUMN IF NOT EXISTS "group" TEXT;
ALTER TABLE "favorites" ADD COLUMN IF NOT EXISTS "note" TEXT;
CREATE INDEX IF NOT EXISTS "favorites_user_id_group_idx" ON "favorites"("userId", "group");

-- 缺口 14：Webhook eventId 重放保护
CREATE TABLE IF NOT EXISTS "webhook_events" (
    "id" BIGSERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orderNo" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_events_provider_eventId_key" ON "webhook_events"("provider", "eventId");
CREATE INDEX IF NOT EXISTS "webhook_events_createdAt_idx" ON "webhook_events"("createdAt" DESC);

-- 缺口 18：短剧 tags GIN 索引
CREATE INDEX IF NOT EXISTS "dramas_tags_gin_idx" ON "dramas" USING GIN ("tags");

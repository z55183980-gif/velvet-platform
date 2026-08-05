-- Feed ranking: count recent watches by drama
CREATE INDEX IF NOT EXISTS "watch_history_dramaId_watchedAt_idx"
  ON "watch_history" ("dramaId", "watchedAt" DESC);

-- Unlock heat in window joins episode → drama
CREATE INDEX IF NOT EXISTS "user_unlocks_unlockedAt_idx"
  ON "user_unlocks" ("unlockedAt" DESC);

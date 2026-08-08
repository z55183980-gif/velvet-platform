-- Banner focal crop for PC hero (object-position percent)
ALTER TABLE "banners"
  ADD COLUMN IF NOT EXISTS "focus_x" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS "focus_y" INTEGER NOT NULL DEFAULT 22;

-- Banner crop zoom percent (50–200); origin follows focus_x / focus_y
ALTER TABLE "banners"
  ADD COLUMN IF NOT EXISTS "focus_zoom" INTEGER NOT NULL DEFAULT 100;

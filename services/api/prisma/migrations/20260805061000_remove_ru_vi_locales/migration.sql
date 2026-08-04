-- Russian and Vietnamese are no longer supported interface locales.
-- Existing users are moved to the canonical English fallback.
UPDATE "users" SET "locale" = 'en' WHERE "locale" IN ('ru', 'vi');
ALTER TABLE "users" ALTER COLUMN "locale" SET DEFAULT 'en';

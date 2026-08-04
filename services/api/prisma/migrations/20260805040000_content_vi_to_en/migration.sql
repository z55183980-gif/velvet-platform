-- Rename content bilingual columns from Vietnamese (*Vi) to English (*En).
ALTER TABLE "categories" RENAME COLUMN "nameVi" TO "nameEn";
ALTER TABLE "dramas" RENAME COLUMN "titleVi" TO "titleEn";
ALTER TABLE "dramas" RENAME COLUMN "descriptionVi" TO "descriptionEn";
ALTER TABLE "banners" RENAME COLUMN "titleVi" TO "titleEn";
ALTER TABLE "notifications" RENAME COLUMN "titleVi" TO "titleEn";
ALTER TABLE "notifications" RENAME COLUMN "bodyVi" TO "bodyEn";

-- Category names: English is primary; add French; allow null Chinese like drama titles.
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "nameFr" TEXT;

ALTER TABLE "categories" ALTER COLUMN "nameZh" DROP NOT NULL;

UPDATE "categories" SET "nameFr" = CASE "slug"
  WHEN 'do_thi' THEN 'Urbain'
  WHEN 'ngon_tinh' THEN 'Romance'
  WHEN 'hanh_dong' THEN 'Action'
  WHEN 'hai_huoc' THEN 'Comédie'
  WHEN 'tam_ly' THEN 'Psychologique'
  WHEN 'co_trang' THEN 'Costume'
  ELSE NULL
END
WHERE "nameFr" IS NULL;

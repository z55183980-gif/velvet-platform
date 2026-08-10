-- Category slug convention: English snake_case (stable API / ?cat= key).
-- Rename legacy Vietnamese romanization slugs and repair nameEn (was VI text).
-- dramas.categorySlug follows via ON UPDATE CASCADE.

UPDATE "categories" SET "slug" = 'urban', "nameEn" = 'Urban' WHERE "slug" = 'do_thi';
UPDATE "categories" SET "slug" = 'romance', "nameEn" = 'Romance' WHERE "slug" = 'ngon_tinh';
UPDATE "categories" SET "slug" = 'action', "nameEn" = 'Action' WHERE "slug" = 'hanh_dong';
UPDATE "categories" SET "slug" = 'comedy', "nameEn" = 'Comedy' WHERE "slug" = 'hai_huoc';
UPDATE "categories" SET "slug" = 'psychological', "nameEn" = 'Psychological' WHERE "slug" = 'tam_ly';
UPDATE "categories" SET "slug" = 'costume', "nameEn" = 'Costume' WHERE "slug" = 'co_trang';

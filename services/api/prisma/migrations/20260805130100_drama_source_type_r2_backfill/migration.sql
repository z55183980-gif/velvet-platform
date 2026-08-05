-- Backfill sourceType=R2 for existing CDN / tagged uploads.
UPDATE "dramas"
SET "sourceType" = 'R2'
WHERE "sourceType" = 'LOCAL'
  AND 'r2' = ANY("tags");

UPDATE "dramas" d
SET "sourceType" = 'R2'
WHERE d."sourceType" = 'LOCAL'
  AND EXISTS (
    SELECT 1
    FROM "episodes" e
    WHERE e."dramaId" = d."id"
      AND (
        e."hlsUrl" ILIKE '%cdn.velvetmovie.space%'
        OR e."originalUrl" ILIKE '%cdn.velvetmovie.space%'
      )
  );

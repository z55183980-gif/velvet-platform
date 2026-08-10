-- Multilingual display labels for Drama.tags keys (English canonical).
CREATE TABLE IF NOT EXISTS "drama_tag_labels" (
    "key" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameZh" TEXT,
    "nameFr" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "drama_tag_labels_pkey" PRIMARY KEY ("key")
);

-- Seed from existing non-system display tags on dramas.
INSERT INTO "drama_tag_labels" ("key", "nameEn", "nameZh", "nameFr", "createdAt", "updatedAt")
SELECT DISTINCT
  t.tag AS "key",
  t.tag AS "nameEn",
  NULL::text AS "nameZh",
  NULL::text AS "nameFr",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM dramas d
CROSS JOIN LATERAL unnest(d.tags) AS t(tag)
WHERE t.tag IS NOT NULL
  AND btrim(t.tag) <> ''
  AND lower(t.tag) NOT IN (
    'upload', 'r2', 'transfer', 'ytdlp', 'local', 'placeholder', 'public',
    'vertical', 'horizontal', 'manual', 'smoke', 'online', 'demo'
  )
  AND t.tag NOT LIKE 'type:%'
  AND t.tag NOT LIKE 'completion:%'
  AND t.tag NOT LIKE 'status:%'
  AND t.tag NOT LIKE 'source:%'
  AND t.tag NOT LIKE 'orientation:%'
  AND t.tag NOT LIKE 'visibility:%'
  AND t.tag NOT LIKE 'workflow:%'
  AND t.tag NOT LIKE 'ytdlp%'
ON CONFLICT ("key") DO NOTHING;

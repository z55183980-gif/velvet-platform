#!/bin/bash
set -eu
cd /www/wwwroot/velvet-platform/services/api
# Apply enum + backfill via docker postgres if available, else prisma
SQL1="ALTER TYPE \"DramaSourceType\" ADD VALUE IF NOT EXISTS 'R2';"
SQL2=$(cat <<'EOS'
UPDATE "dramas" SET "sourceType" = 'R2' WHERE "sourceType" = 'LOCAL' AND 'r2' = ANY("tags");
UPDATE "dramas" d SET "sourceType" = 'R2' WHERE d."sourceType" = 'LOCAL' AND EXISTS (SELECT 1 FROM "episodes" e WHERE e."dramaId" = d."id" AND (e."hlsUrl" ILIKE '%cdn.velvetmovie.space%' OR e."originalUrl" ILIKE '%cdn.velvetmovie.space%'));
EOS
)
# Prefer docker exec velvet-postgres
if docker ps --format '{{.Names}}' | grep -q '^velvet-postgres$'; then
  DB_URL=$(grep '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  # extract db name user from URL roughly: postgresql://user:pass@host:port/db
  USER=$(echo "$DB_URL" | sed -E 's|postgresql://([^:]+):.*|\1|')
  DB=$(echo "$DB_URL" | sed -E 's|.*/([^?]+).*|\1|')
  echo "using docker velvet-postgres user=$USER db=$DB"
  docker exec -i velvet-postgres psql -U "$USER" -d "$DB" -v ON_ERROR_STOP=1 -c "$SQL1"
  docker exec -i velvet-postgres psql -U "$USER" -d "$DB" -v ON_ERROR_STOP=1 -c "$SQL2"
else
  npx prisma db execute --schema prisma/schema.prisma --stdin <<EOF
$SQL1
EOF
  echo "$SQL2" | npx prisma db execute --schema prisma/schema.prisma --stdin
fi
echo "counts:"
docker exec -i velvet-postgres psql -U "$USER" -d "$DB" -c 'SELECT "sourceType", COUNT(*) FROM dramas GROUP BY 1 ORDER BY 1;'
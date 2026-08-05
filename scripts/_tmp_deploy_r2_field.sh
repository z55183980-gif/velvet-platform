#!/bin/bash
set -eu
cd /www/wwwroot/velvet-platform
pnpm --filter velvet-api exec prisma generate
pnpm --filter velvet-api build
pnpm --filter velvet-admin build
pm2 restart velvet-api velvet-admin
sleep 2
pm2 list | grep -E "velvet-api|velvet-admin"
docker exec -i velvet-postgres psql -U velvet -d velvet -c "SELECT \"sourceType\", COUNT(*) FROM dramas GROUP BY 1 ORDER BY 1;"
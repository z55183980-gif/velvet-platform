#!/usr/bin/env bash
# Velvet DR / backup drill stub — fill in real host paths & credentials before use.
# Usage: bash scripts/dr-backup-checklist.sh
set -euo pipefail

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${DR_BACKUP_DIR:-/var/backups/velvet}"
mkdir -p "$OUT_DIR"

echo "== Velvet DR checklist @ ${STAMP} =="
echo "1) DB dump (edit connection):"
echo "   pg_dump \"\$DATABASE_URL\" -Fc -f \"${OUT_DIR}/velvet-${STAMP}.dump\""
echo "2) Verify dump size > 0"
echo "3) Optional staging restore:"
echo "   pg_restore --clean --if-exists -d \"\$STAGING_DATABASE_URL\" \"${OUT_DIR}/velvet-${STAMP}.dump\""
echo "4) Media sample: list STORAGE_ROOT + R2 bucket object count"
echo "5) Record RTO/RPO notes in ops log"
echo ""
echo "Refusing to run destructive restore automatically."
echo "Checklist doc: docs/11-生产部署手册.md §8"

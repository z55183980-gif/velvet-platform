#!/usr/bin/env bash
# Velvet DR backup / verify / restore dry-run.
# Usage:
#   bash scripts/dr-backup-checklist.sh
# Env:
#   DATABASE_URL          required for real dump (else fail-closed with steps)
#   DR_BACKUP_DIR         default /var/backups/velvet
#   STAGING_DATABASE_URL  optional — enables pg_restore --dry-run verify
#   DR_SKIP_RESTORE=1     skip restore dry-run even if staging URL set
set -euo pipefail

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${DR_BACKUP_DIR:-/var/backups/velvet}"
mkdir -p "$OUT_DIR"
DUMP_PATH="${OUT_DIR}/velvet-${STAMP}.dump"

echo "== Velvet DR checklist @ ${STAMP} =="

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "FAIL-CLOSED: DATABASE_URL unset."
  echo "Set DATABASE_URL (and optionally STAGING_DATABASE_URL) then re-run."
  echo "Manual steps:"
  echo "  1) pg_dump \"\$DATABASE_URL\" -Fc -f \"${OUT_DIR}/velvet-${STAMP}.dump\""
  echo "  2) Verify dump size > 0"
  echo "  3) pg_restore --list \"${OUT_DIR}/velvet-${STAMP}.dump\" | head"
  echo "  4) Optional: pg_restore --clean --if-exists -d \"\$STAGING_DATABASE_URL\" dump"
  echo "  5) Run scripts/finance-migrate-rehearsal.sql on staging restore"
  echo "Ref: docs/11-生产部署手册.md §8"
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "FAIL-CLOSED: pg_dump not found in PATH."
  exit 1
fi

echo "1) DB dump → ${DUMP_PATH}"
pg_dump "$DATABASE_URL" -Fc -f "$DUMP_PATH"
SIZE="$(wc -c <"$DUMP_PATH" | tr -d ' ')"
if [[ "${SIZE}" -le 0 ]]; then
  echo "FAIL: dump size is 0"
  exit 1
fi
echo "   OK size=${SIZE} bytes"

echo "2) Verify dump TOC"
pg_restore --list "$DUMP_PATH" | head -n 20
echo "   OK list readable"

if [[ -n "${STAGING_DATABASE_URL:-}" && "${DR_SKIP_RESTORE:-0}" != "1" ]]; then
  echo "3) Restore dry-run against STAGING_DATABASE_URL"
  # --dry-run prints plan without applying (PostgreSQL 16+); fall back to list-only.
  if pg_restore --help 2>&1 | grep -q -- '--dry-run'; then
    pg_restore --dry-run --clean --if-exists -d "$STAGING_DATABASE_URL" "$DUMP_PATH" >/tmp/velvet-dr-restore-plan.txt
    echo "   OK dry-run plan → /tmp/velvet-dr-restore-plan.txt"
  else
    echo "   WARN: pg_restore lacks --dry-run; listing TOC only (no apply)."
    pg_restore --list "$DUMP_PATH" >/tmp/velvet-dr-restore-plan.txt
  fi
  echo "4) Finance checksum rehearsal (staging):"
  echo "   psql \"\$STAGING_DATABASE_URL\" -v ON_ERROR_STOP=1 -f scripts/finance-migrate-rehearsal.sql"
else
  echo "3) Restore dry-run SKIPPED (set STAGING_DATABASE_URL to enable)"
fi

echo "5) Media sample reminders:"
echo "   - list STORAGE_ROOT sample objects"
echo "   - R2 bucket object count / sample GET"
echo "6) Record RTO/RPO + dump path in ops log"
echo ""
echo "SUCCESS: backup written to ${DUMP_PATH}"
echo "Checklist doc: docs/11-生产部署手册.md §8"

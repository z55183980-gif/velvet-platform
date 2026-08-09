#!/usr/bin/env bash
# Fail-closed pre-migrate gate (dual wallet columns + DB timezone).
# Does NOT rewrite applied Prisma migration SQL — run before `prisma migrate deploy`.
#
# Usage:
#   bash scripts/pre-migrate-gate.sh
# Env:
#   DATABASE_URL   required
#   GATE_ALLOW_NON_UTC=1  escape hatch (not for prod)
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "FAIL: DATABASE_URL unset"
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "FAIL: psql not found in PATH (install client tools before migrate)"
  exit 1
fi

echo "== Velvet pre-migrate gate =="

# 1) Session / DB timezone must be UTC (skew risk for timestamp without time zone).
TZ_ROW="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SHOW timezone;")"
echo "timezone=${TZ_ROW}"
if [[ "${TZ_ROW}" != "UTC" && "${TZ_ROW}" != "Etc/UTC" && "${TZ_ROW}" != "utc" ]]; then
  if [[ "${GATE_ALLOW_NON_UTC:-0}" == "1" ]]; then
    echo "WARN: non-UTC timezone allowed via GATE_ALLOW_NON_UTC=1"
  else
    echo "FAIL: database timezone is '${TZ_ROW}', expected UTC"
    exit 1
  fi
fi

# 2) Dual wallet columns with inconsistent data → refuse migrate.
MISMATCH="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
DO \$\$
DECLARE
  has_vnd boolean;
  has_credits boolean;
  mismatch bigint := 0;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='wallets' AND column_name='balanceVnd'
  ) INTO has_vnd;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='wallets' AND column_name='balanceCredits'
  ) INTO has_credits;

  IF has_vnd AND has_credits THEN
    EXECUTE 'SELECT COUNT(*) FROM wallets WHERE \"balanceVnd\" IS DISTINCT FROM \"balanceCredits\"' INTO mismatch;
    IF mismatch > 0 THEN
      RAISE EXCEPTION 'GATE_DUAL_WALLET_MISMATCH count=%', mismatch;
    END IF;
    RAISE NOTICE 'dual wallet columns present but values agree (mismatch=0)';
  ELSE
    RAISE NOTICE 'single wallet column set — OK';
  END IF;
END \$\$;
SELECT 'ok';
")"

echo "wallet_gate=${MISMATCH}"

# 3) Optional: also fail if dual columns still exist (destructive DROP pending).
# Comment: informational only — prod may already be credits-only.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='wallets' AND column_name='balanceVnd'
  ) AS has_legacy_balance_vnd,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='wallets' AND column_name='balanceCredits'
  ) AS has_balance_credits;
"

echo "SUCCESS: pre-migrate gate passed"
echo "Next: bash scripts/dr-backup-checklist.sh && npx prisma migrate deploy"
echo "Rehearsal SQL: scripts/finance-migrate-rehearsal.sql"

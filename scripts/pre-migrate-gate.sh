#!/usr/bin/env bash
# Fail-closed pre-migrate gate (dual wallet / txn columns + DB timezone).
# Does NOT rewrite applied Prisma migration SQL — run before `prisma migrate deploy`.
#
# Compares ALL columns that schema_reconcile / finance migrations may DROP or RENAME
# (not only balance*). Any mismatch ⇒ refuse migrate (silent data loss risk).
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
  echo "FAIL: psql not found in PATH (install postgresql-client before migrate)"
  echo "Handbook: docs/11-生产部署手册.md requires gate + psql on the migrate host."
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

# 2) Dual / rename-risk columns: values must agree before DROP/RENAME can proceed.
# Covers wallets balance*/total* and wallet_transactions amount* pairs from
# migrations/20260810013000_schema_reconcile_p0 (do not edit applied SQL).
GATE_OUT="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
DO \$\$
DECLARE
  mismatch bigint;
  col_a text;
  col_b text;
  tbl text;
  pairs text[][] := ARRAY[
    ARRAY['wallets', 'balanceVnd', 'balanceCredits'],
    ARRAY['wallets', 'totalRecharged', 'totalRechargedCredits'],
    ARRAY['wallets', 'totalSpent', 'totalSpentCredits'],
    ARRAY['wallet_transactions', 'amountVnd', 'amountCredits']
  ];
  i int;
  has_a boolean;
  has_b boolean;
BEGIN
  FOR i IN 1 .. array_length(pairs, 1) LOOP
    tbl := pairs[i][1];
    col_a := pairs[i][2];
    col_b := pairs[i][3];

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=tbl AND column_name=col_a
    ) INTO has_a;
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=tbl AND column_name=col_b
    ) INTO has_b;

    IF has_a AND has_b THEN
      EXECUTE format(
        'SELECT COUNT(*) FROM %I WHERE %I IS DISTINCT FROM %I',
        tbl, col_a, col_b
      ) INTO mismatch;
      IF mismatch > 0 THEN
        RAISE EXCEPTION 'GATE_DUAL_COL_MISMATCH table=% % vs % count=%',
          tbl, col_a, col_b, mismatch;
      END IF;
      RAISE NOTICE 'dual ok %.% == %.% (mismatch=0)', tbl, col_a, tbl, col_b;
    ELSIF has_a AND NOT has_b THEN
      RAISE NOTICE 'legacy-only %.% present (credits rename not applied yet)', tbl, col_a;
    ELSIF has_b AND NOT has_a THEN
      RAISE NOTICE 'credits-only %.% present — OK', tbl, col_b;
    ELSE
      RAISE NOTICE 'neither %.% nor %.% — skip', tbl, col_a, tbl, col_b;
    END IF;
  END LOOP;
END \$\$;
SELECT 'ok';
")"

echo "column_gate=${GATE_OUT}"

# 3) Informational column presence (destructive DROP pending?).
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
SELECT
  c.table_name,
  c.column_name,
  c.data_type
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND (
    (c.table_name = 'wallets' AND c.column_name IN (
      'balanceVnd','balanceCredits','totalRecharged','totalRechargedCredits',
      'totalSpent','totalSpentCredits'
    ))
    OR
    (c.table_name = 'wallet_transactions' AND c.column_name IN (
      'amountVnd','amountCredits'
    ))
  )
ORDER BY c.table_name, c.column_name;
"

echo "SUCCESS: pre-migrate gate passed"
echo "Next: bash scripts/dr-backup-checklist.sh && npx prisma migrate deploy"
echo "Rehearsal SQL: scripts/finance-migrate-rehearsal.sql"
echo "REQUIREMENT: migrate host must have psql; never skip this gate in prod."

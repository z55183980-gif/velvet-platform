-- Velvet finance / schema migrate rehearsal queries
-- Run against a **restored prod snapshot** (never against live prod write path).
-- Usage:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/finance-migrate-rehearsal.sql
--
-- Purpose: prove column coexistence / checksums BEFORE applying destructive drops
-- from schema_reconcile_p0 (already-applied migration SQL files are not rewritten).

\echo '=== 1) Wallet column coexistence (legacy Vnd vs credits) ==='
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wallets'
      AND column_name = 'balanceVnd'
  ) AS has_legacy_balance_vnd,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wallets'
      AND column_name = 'balanceCredits'
  ) AS has_balance_credits,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wallets'
      AND column_name = 'totalRecharged'
  ) AS has_legacy_total_recharged,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wallets'
      AND column_name = 'totalRechargedCredits'
  ) AS has_total_recharged_credits;

\echo '=== 2) If BOTH wallet columns exist: compare before DROP ==='
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wallets' AND column_name = 'balanceVnd'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wallets' AND column_name = 'balanceCredits'
  ) THEN
    RAISE NOTICE 'BOTH balanceVnd and balanceCredits present — MUST compare/merge before DROP';
    -- Manual compare (run when both exist):
    -- SELECT COUNT(*) FILTER (WHERE "balanceVnd" IS DISTINCT FROM "balanceCredits") AS mismatch
    -- FROM wallets;
  ELSE
    RAISE NOTICE 'Single wallet column set — drop-both path not applicable on this snapshot';
  END IF;
END $$;

\echo '=== 3) Finance totals checksum (*Vnd columns = USD cents) ==='
SELECT
  o."orderType",
  o."paymentMethod",
  o."paymentStatus",
  COUNT(*) AS cnt,
  COALESCE(SUM(o."amountVnd"), 0) AS sum_amount_usd_cents,
  COALESCE(SUM(o."amountCredits"), 0) AS sum_credits,
  COALESCE(SUM(o."creatorIncomeVnd"), 0) AS sum_creator_usd_cents,
  COALESCE(SUM(o."platformFeeVnd"), 0) AS sum_platform_usd_cents
FROM orders o
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

\echo '=== 4) Creator earning ledger totals ==='
SELECT
  COUNT(*) AS creators,
  COALESCE(SUM("pendingVnd"), 0) AS pending_usd_cents,
  COALESCE(SUM("availableVnd"), 0) AS available_usd_cents,
  COALESCE(SUM("withdrawnVnd"), 0) AS withdrawn_usd_cents,
  COALESCE(SUM("totalEarnedVnd"), 0) AS total_earned_usd_cents
FROM creator_earnings;

\echo '=== 5) Dirty / frozen unlock orders ==='
SELECT COUNT(*) AS frozen_or_dirty
FROM orders
WHERE "orderType" IN ('EPISODE_UNLOCK', 'DRAMA_BUYOUT')
  AND (
    COALESCE((meta->>'ledgerDirty')::boolean, false)
    OR COALESCE((meta->>'creatorAccrualSkipped')::boolean, false)
    OR COALESCE((meta->>'financeFrozen')::boolean, false)
  );

\echo '=== 6) Timestamp type sample (UTC residual risk) ==='
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND data_type IN ('timestamp without time zone', 'timestamp with time zone')
  AND column_name IN ('createdAt', 'updatedAt', 'paidAt', 'refundedAt', 'rightsVerifiedAt', 'resolvedAt')
ORDER BY 1, 2;

\echo 'Done. Record checksums in ops log before/after migrate deploy on the snapshot.'

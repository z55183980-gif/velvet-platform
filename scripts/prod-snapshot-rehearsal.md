# Prod snapshot rehearsal (executable checklist)

Use before any finance-touching migrate / unfreeze. Does **not** rewrite applied Prisma migration SQL.

## Prerequisites

- Ops access to prod read replica or maintenance dump credentials
- Staging Postgres that can be wiped
- `pg_dump` / `pg_restore` / `psql` on the jump host

## Steps

1. **Announce freeze** — keep `FINANCE_OPS_FROZEN=1` (default).
2. **Dump prod**  
   ```bash
   export DATABASE_URL='postgresql://…'   # prod or replica
   export DR_BACKUP_DIR=/var/backups/velvet
   bash scripts/dr-backup-checklist.sh
   ```
3. **Restore to staging** (real restore, not dry-run):  
   ```bash
   pg_restore --clean --if-exists -d "$STAGING_DATABASE_URL" /var/backups/velvet/velvet-*.dump
   ```
4. **Pre-migrate checksums**  
   ```bash
   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/finance-migrate-rehearsal.sql | tee /tmp/finance-pre.txt
   ```
5. **Migrate on staging**  
   ```bash
   cd services/api && DATABASE_URL="$STAGING_DATABASE_URL" npx prisma migrate deploy
   ```
6. **Post-migrate checksums** — re-run step 4 → `/tmp/finance-post.txt`  
   Diff order/creator totals; investigate any drop in `sum_amount_usd_cents` / creator pending.
7. **Column coexistence** — if rehearsal shows both `balanceVnd` + `balanceCredits`, **stop** and write a forward merge migration before touching prod.
8. **App smoke on staging** — API `/api/health/ready`, unlock with `USD_CENTS_PER_CREDIT` set, Stripe test refund saga.
9. **Only then** schedule prod migrate window (handbook §2.5 / §3 / §6).

## Residual risks (document in deploy log)

| Risk | Mitigation |
|------|------------|
| `schema_reconcile_p0` drops leftover wallet cols without merge | Snapshot compare in step 4–6; forward migration if both exist |
| `TIMESTAMP` vs `TIMESTAMPTZ` (UTC) | Sample types in rehearsal SQL; treat naive timestamps as UTC in app |
| Empty CI DB ≠ prod shape | This rehearsal is mandatory for finance releases |
| No auto DB rollback on app boot failure | Expand-then-contract migrations; keep dump from step 2 |

## CI note

GitHub Actions migrates an **empty** DB only. Treat green CI as necessary but not sufficient for prod finance migrates.

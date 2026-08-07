-- Drop obsolete CNY-relative FX tables (pricing is USD-only).
DROP TABLE IF EXISTS "exchange_rate_histories";
DROP TABLE IF EXISTS "credit_exchange_rates";

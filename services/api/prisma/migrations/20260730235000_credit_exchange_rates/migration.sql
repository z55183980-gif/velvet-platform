-- Fix: these tables were referenced by later migrations (e.g. 20260730240000_topup_packages)
-- but never had a CREATE TABLE migration of their own — they only ever existed via `prisma db push`.
-- CreateTable
CREATE TABLE IF NOT EXISTS "credit_exchange_rates" (
    "id" BIGSERIAL NOT NULL,
    "currency" TEXT NOT NULL,
    "buyRate" DECIMAL(18,8) NOT NULL,
    "sellRate" DECIMAL(18,8) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "credit_exchange_rates_currency_key" ON "credit_exchange_rates"("currency");

-- CreateTable
CREATE TABLE IF NOT EXISTS "exchange_rate_histories" (
    "id" BIGSERIAL NOT NULL,
    "currency" TEXT NOT NULL,
    "prevBuyRate" DECIMAL(18,8),
    "prevSellRate" DECIMAL(18,8),
    "newBuyRate" DECIMAL(18,8) NOT NULL,
    "newSellRate" DECIMAL(18,8) NOT NULL,
    "actorId" BIGINT,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rate_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_rate_histories_currency_createdAt_idx" ON "exchange_rate_histories"("currency", "createdAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_rate_histories_actorId_createdAt_idx" ON "exchange_rate_histories"("actorId", "createdAt" DESC);

-- 种子基础汇率（若表空），供后续 UPDATE 迁移使用
INSERT INTO "credit_exchange_rates" ("currency", "buyRate", "sellRate", "updatedAt")
SELECT * FROM (VALUES
  ('CNY', 1::decimal, 1::decimal, CURRENT_TIMESTAMP),
  ('VND', 3500::decimal, 3500::decimal, CURRENT_TIMESTAMP)
) AS v(currency, "buyRate", "sellRate", "updatedAt")
WHERE NOT EXISTS (SELECT 1 FROM "credit_exchange_rates" LIMIT 1);

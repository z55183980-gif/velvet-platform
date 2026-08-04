-- Pricing is now direct USD (no FX quote). Update legacy CNY baseCurrency.
ALTER TABLE "topup_packages" ALTER COLUMN "baseCurrency" SET DEFAULT 'USD';
ALTER TABLE "vip_plans" ALTER COLUMN "baseCurrency" SET DEFAULT 'USD';

UPDATE "topup_packages" SET "baseCurrency" = 'USD' WHERE "baseCurrency" <> 'USD';
UPDATE "vip_plans" SET "baseCurrency" = 'USD' WHERE "baseCurrency" <> 'USD';

/**
 * Canonical ledger money unit: **USD cents** (integer minor units).
 *
 * Legacy Prisma columns (`amountVnd`, `creatorIncomeVnd`, `platformFeeVnd`,
 * `CreatorEarning.*Vnd`, `WithdrawRequest.amountVnd`) retain `Vnd` names but
 * MUST be interpreted as USD cents after the global USD unification.
 *
 * Credits are a separate product unit (not money). Convert at write boundaries
 * via `usdCentsPerCredit` (platform setting / env). Never mix raw credits into
 * `*Vnd` money columns without conversion.
 *
 * Wallet TOPUP already writes Stripe/pay amounts as USD cents into `amountVnd`.
 * Historical unlock/buyout rows may still store credits or VND — treat as dirty
 * until ops reconciliation (see docs/12-财务单位与对账.md).
 */

export const LEDGER_CURRENCY = 'USD' as const;
export const LEDGER_MINOR_UNIT = 'USD_CENTS' as const;

/** Default freeze: money ops frozen until unit reconciliation completes. */
export function isFinanceOpsFrozen(): boolean {
  const raw = (
    process.env.FINANCE_OPS_FROZEN ??
    process.env.VELVET_FINANCE_FROZEN ??
    '1'
  )
    .trim()
    .toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return false;
  return true;
}

/**
 * USD cents per 1 credit. Prefer explicit env/setting; null means unknown
 * (do not invent a rate for settlement/backfill).
 */
export function resolveUsdCentsPerCredit(
  settingValue?: number | null,
): number | null {
  if (settingValue != null && Number.isFinite(settingValue) && settingValue > 0) {
    return settingValue;
  }
  const env = Number(process.env.USD_CENTS_PER_CREDIT);
  if (Number.isFinite(env) && env > 0) return env;
  return null;
}

/** credits → USD cents (floor). Returns null if rate unknown. */
export function creditsToUsdCents(
  credits: bigint,
  usdCentsPerCredit: number | null,
): bigint | null {
  if (usdCentsPerCredit == null || !Number.isFinite(usdCentsPerCredit) || usdCentsPerCredit <= 0) {
    return null;
  }
  // Avoid float drift for typical small rates: work in micro-cents then floor.
  const micros = BigInt(Math.round(usdCentsPerCredit * 1_000_000));
  if (micros <= 0n) return null;
  return (credits * micros) / 1_000_000n;
}

export type WalletLedgerSplit = {
  amountUsdCents: bigint;
  creatorIncomeUsdCents: bigint;
  platformFeeUsdCents: bigint;
  usdCentsPerCredit: number;
  financeFrozen: boolean;
  deferredCreatorIncomeUsdCents: bigint | null;
};

/**
 * Wallet unlock/buyout money split. Returns null when rate unknown (caller must fail closed).
 * While finance frozen: creatorIncomeUsdCents=0; deferred amount kept for ops backfill.
 */
export function splitWalletCreditsLedger(
  credits: bigint,
  revenueShare: number,
  opts?: { usdCentsPerCredit?: number | null; financeFrozen?: boolean },
): WalletLedgerSplit | null {
  const rate = resolveUsdCentsPerCredit(opts?.usdCentsPerCredit ?? null);
  const amountUsdCents = creditsToUsdCents(credits, rate);
  if (amountUsdCents == null || rate == null) return null;
  const share = Number.isFinite(revenueShare) ? Math.min(1, Math.max(0, revenueShare)) : 0;
  const shareIncome = BigInt(Math.floor(Number(amountUsdCents) * share));
  const frozen = opts?.financeFrozen ?? isFinanceOpsFrozen();
  if (frozen) {
    return {
      amountUsdCents,
      creatorIncomeUsdCents: 0n,
      platformFeeUsdCents: amountUsdCents,
      usdCentsPerCredit: rate,
      financeFrozen: true,
      deferredCreatorIncomeUsdCents: shareIncome,
    };
  }
  return {
    amountUsdCents,
    creatorIncomeUsdCents: shareIncome,
    platformFeeUsdCents: amountUsdCents - shareIncome,
    usdCentsPerCredit: rate,
    financeFrozen: false,
    deferredCreatorIncomeUsdCents: null,
  };
}

/** payAmount is USD major units; amountUsdCents is minor. Never assign cents into payAmount. */
export function usdCentsToPayAmountMajor(amountUsdCents: bigint): string {
  const n = Number(amountUsdCents);
  if (!Number.isFinite(n)) return '0.00';
  return (n / 100).toFixed(2);
}

export function financeFreezePayload() {
  return {
    financeOpsFrozen: isFinanceOpsFrozen(),
    ledgerCurrency: LEDGER_CURRENCY,
    ledgerMinorUnit: LEDGER_MINOR_UNIT,
    reportsTrustworthy: !isFinanceOpsFrozen(),
    note:
      'GMV/share/withdraw frozen until historical amountVnd rows are reconciled to USD cents',
  };
}

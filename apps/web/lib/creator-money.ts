/**
 * Creator-center display helper.
 * API ledger fields keep the legacy `*Vnd` suffix; unlock/buyout income is stored
 * in the same numeric unit as charged credits (1 credit ≈ 1 display unit).
 * Top-up `amountVnd` elsewhere may be USD cents — do not reuse this formatter for orders.
 */
export function formatCreatorUsd(value: number | string | null | undefined): string {
  const n = Number(value || 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

/** Admin form helpers: suggest display badges from pricing fields. */

export function suggestTopupBonusBadge(baseCredits: number, bonusCredits: number): string {
  const base = Math.max(0, Number(baseCredits) || 0);
  const bonus = Math.max(0, Number(bonusCredits) || 0);
  if (base < 1 || bonus < 1) return "";
  const pct = Math.round((bonus / base) * 100);
  if (pct < 1) return "";
  return `+${pct}%`;
}

export function suggestVipDiscountBadge(
  basePrice: number,
  originalPrice?: number | null,
): string {
  const price = Number(basePrice) || 0;
  if (originalPrice == null) return "";
  const original = Number(originalPrice);
  if (!(price > 0) || !Number.isFinite(original) || !(original > price)) return "";
  const pct = Math.round(((original - price) / original) * 100);
  if (pct < 1) return "";
  return `${pct}% OFF`;
}

/** Keep auto-updating while badge is empty or still equals the last auto suggestion. */
export function shouldApplySuggestedBadge(
  currentBadge: string | null | undefined,
  lastAutoBadge: string,
): boolean {
  const cur = (currentBadge || "").trim();
  return !cur || cur === lastAutoBadge;
}

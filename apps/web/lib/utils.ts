import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const MONEY_LOCALE = "en-US";

/** Plain en-US grouping for credits / integer amounts (e.g. 1,234). */
export function formatAmount(amount: number): string {
  return new Intl.NumberFormat(MONEY_LOCALE).format(amount);
}

/** USD money display (e.g. $1,234.56). */
export function formatUsd(amount: number): string {
  return new Intl.NumberFormat(MONEY_LOCALE, {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

/** Compact engagement counts: zh uses 万, all other locales use K. */
export function formatCount(n: number, locale: string) {
  const value = Math.max(0, Math.floor(Number(n) || 0));
  if (locale === "zh") {
    if (value >= 10_000) {
      const w = value / 10_000;
      const s = w >= 100 ? String(Math.round(w)) : w.toFixed(1).replace(/\.0$/, "");
      return `${s}万`;
    }
    return String(value);
  }
  if (value >= 1_000) {
    const k = value / 1_000;
    const s = k >= 100 ? String(Math.round(k)) : k.toFixed(1).replace(/\.0$/, "");
    return `${s}K`;
  }
  return String(value);
}

/** @param unit i18n label, e.g. t("card.credits") — defaults avoid hard-coded 中文 */
export function formatCredits(amount: number, unit = "credits"): string {
  return `${formatAmount(amount)} ${unit}`;
}

/** 相对存储路径 → 媒体 URL */
export function mediaUrl(path?: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path) || path.startsWith("/")) return path;
  return `/api/v1/media/${path.replace(/^\/+/, "")}`;
}

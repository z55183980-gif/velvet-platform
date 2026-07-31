import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatVnd(amount: number): string {
  return new Intl.NumberFormat("vi-VN").format(amount) + " ₫";
}

/** @param unit i18n label, e.g. t("card.credits") — defaults avoid hard-coded 中文 */
export function formatCredits(amount: number, unit = "credits"): string {
  return `${new Intl.NumberFormat("vi-VN").format(amount)} ${unit}`;
}

/** 相对存储路径 → 媒体 URL */
export function mediaUrl(path?: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path) || path.startsWith("/")) return path;
  return `/api/v1/media/${path.replace(/^\/+/, "")}`;
}

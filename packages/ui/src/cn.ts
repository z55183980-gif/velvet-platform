import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtNum(v: string | number | bigint | null | undefined) {
  if (v == null) return "0";
  const n = typeof v === "bigint" ? Number(v) : Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString();
}

export function fmtDate(v: string | Date | null | undefined) {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export function hoursAgo(v: string | Date | null | undefined) {
  if (!v) return 0;
  const d = typeof v === "string" ? new Date(v) : v;
  return (Date.now() - d.getTime()) / 3600000;
}

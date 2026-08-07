import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Custom type scale uses `text-body-sm` etc. Default twMerge treats those as
 * conflicting with `text-white` / `text-ink` (same `text-*` group), which
 * silently drops button text colors — black on wine-red then becomes unreadable.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "display",
            "h1",
            "h2",
            "h3",
            "h4",
            "body-lg",
            "body",
            "body-sm",
            "caption",
            "overline",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtNum(v: string | number | bigint | null | undefined) {
  if (v == null) return "0";
  const n = typeof v === "bigint" ? Number(v) : Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString();
}

export function fmtDate(v: string | Date | null | undefined, locale?: string) {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return "—";
  return locale ? d.toLocaleString(locale) : d.toLocaleString();
}

export function hoursAgo(v: string | Date | null | undefined) {
  if (!v) return 0;
  const d = typeof v === "string" ? new Date(v) : v;
  return (Date.now() - d.getTime()) / 3600000;
}

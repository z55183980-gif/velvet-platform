import { asRows, type Paginated } from "@velvet/api-client";

/** Same options as Ops 剧集管理 (`apps/admin/app/content/page.tsx`). */
export const ADMIN_PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
export type AdminPageSize = (typeof ADMIN_PAGE_SIZE_OPTIONS)[number];

export function parseAdminPage(raw: string | null | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

export function parseAdminPageSize(raw: string | null | undefined): number {
  const n = Number(raw);
  return (ADMIN_PAGE_SIZE_OPTIONS as readonly number[]).includes(n) ? n : 20;
}

/** Page number strip with ellipsis — matches 剧集管理. */
export function paginationItems(page: number, total: number): Array<number | "ellipsis"> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const visible = new Set([1, total, page - 1, page, page + 1]);
  const pages = [...visible].filter((value) => value >= 1 && value <= total).sort((a, b) => a - b);
  const result: Array<number | "ellipsis"> = [];
  pages.forEach((value, index) => {
    if (index > 0 && value - pages[index - 1]! > 1) result.push("ellipsis");
    result.push(value);
  });
  return result;
}

export function asPaginatedList<T>(data: Paginated<T> | T[] | null | undefined): {
  rows: T[];
  total: number;
} {
  const rows = asRows<T>(data);
  const total =
    data && !Array.isArray(data) && typeof data.total === "number" ? data.total : rows.length;
  return { rows, total };
}

/** Write page / pageSize into the current URL (omit defaults: page=1, pageSize=20). */
export function patchListPaginationUrl(opts: {
  page: number;
  pageSize: number;
  extra?: (url: URL) => void;
}) {
  const url = new URL(window.location.href);
  if (opts.page > 1) url.searchParams.set("page", String(opts.page));
  else url.searchParams.delete("page");
  if (opts.pageSize !== 20) url.searchParams.set("pageSize", String(opts.pageSize));
  else url.searchParams.delete("pageSize");
  opts.extra?.(url);
  window.history.replaceState(null, "", url.pathname + url.search);
}

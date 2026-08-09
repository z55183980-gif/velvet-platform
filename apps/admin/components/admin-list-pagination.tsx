"use client";

import { useState } from "react";
import { Button, Input, Select } from "@velvet/ui";
import {
  ADMIN_PAGE_SIZE_OPTIONS,
  paginationItems,
} from "@/lib/admin-list-pagination";
import { useI18n } from "@/lib/i18n";

type AdminListPaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  loading?: boolean;
  className?: string;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

/**
 * Shared Ops list pagination — visual + interaction parity with 剧集管理
 * (`apps/admin/app/content/page.tsx`).
 */
export function AdminListPagination({
  page,
  pageSize,
  total,
  loading,
  className,
  onPageChange,
  onPageSizeChange,
}: AdminListPaginationProps) {
  const { t } = useI18n();
  const [jumpPage, setJumpPage] = useState("");
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function goToPage(nextPage: number) {
    const clamped = Math.min(Math.max(1, nextPage), totalPages);
    onPageChange(clamped);
  }

  if (total <= 0) return null;

  return (
    <div
      className={`mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white/45 px-3 py-2 text-caption text-ink-muted${className ? ` ${className}` : ""}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span>{`${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} / ${total}`}</span>
        <Select
          className="h-8 w-28 text-caption"
          value={String(pageSize)}
          onChange={(e) => {
            const next = Number(e.target.value);
            onPageSizeChange(next);
          }}
        >
          {ADMIN_PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n} / {t("page")}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="secondary"
          disabled={page <= 1 || loading}
          onClick={() => goToPage(page - 1)}
        >
          {t("previousPage")}
        </Button>
        <div className="hidden items-center gap-1 sm:flex">
          {paginationItems(page, totalPages).map((item, index) =>
            item === "ellipsis" ? (
              <span key={`ellipsis-${index}`} className="grid h-9 w-7 place-items-center text-ink-subtle">
                …
              </span>
            ) : (
              <button
                key={item}
                type="button"
                aria-current={item === page ? "page" : undefined}
                disabled={loading}
                onClick={() => goToPage(item)}
                className={[
                  "grid h-9 min-w-9 place-items-center rounded-xl px-2 font-medium transition",
                  item === page
                    ? "bg-brand text-white shadow-brand"
                    : "border border-white/70 bg-white/65 text-ink-muted hover:-translate-y-0.5 hover:bg-white hover:text-ink hover:shadow-sm",
                ].join(" ")}
              >
                {item}
              </button>
            ),
          )}
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={page >= totalPages || loading}
          onClick={() => goToPage(page + 1)}
        >
          {t("nextPage")}
        </Button>
        {totalPages > 1 ? (
          <div className="ml-2 hidden items-center gap-1 lg:flex">
            <Input
              type="number"
              min={1}
              max={totalPages}
              className="h-9 w-16 px-2 text-center text-caption"
              value={jumpPage}
              placeholder={String(page)}
              onChange={(event) => setJumpPage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && jumpPage) {
                  goToPage(Number(jumpPage));
                  setJumpPage("");
                }
              }}
            />
            <Button
              size="sm"
              variant="ghost"
              disabled={!jumpPage || loading}
              onClick={() => {
                goToPage(Number(jumpPage));
                setJumpPage("");
              }}
            >
              {t("goToPage")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

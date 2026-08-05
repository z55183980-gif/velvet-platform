"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Filter, Plus, Search, X } from "lucide-react";
import { Badge, Button, Input, Select } from "@velvet/ui";
import { statusLabel, useI18n } from "@/lib/i18n";

export type ContentSearchFilters = {
  q: string;
  status: string;
  categorySlug: string;
  isOfficial: string;
  isFeatured: string;
  /** r2 | local | online | "" */
  mediaKind: string;
  sort: "weight" | "latest";
};

type CategoryOption = { slug: string; nameZh?: string; nameEn?: string };

type ContentSearchBarProps = {
  value: ContentSearchFilters;
  onChange: (next: ContentSearchFilters) => void;
  categories: CategoryOption[];
  statuses: string[];
  showAdd?: boolean;
  onAdd?: () => void;
};

const DEBOUNCE_MS = 300;

function countActiveFilters(value: ContentSearchFilters) {
  let n = 0;
  if (value.status && value.status !== "ALL") n += 1;
  if (value.categorySlug) n += 1;
  if (value.isOfficial) n += 1;
  if (value.isFeatured) n += 1;
  if (value.mediaKind) n += 1;
  return n;
}

export function ContentSearchBar({
  value,
  onChange,
  categories,
  statuses,
  showAdd = true,
  onAdd,
}: ContentSearchBarProps) {
  const { t } = useI18n();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const [qDraft, setQDraft] = useState(value.q);
  const [panelOpen, setPanelOpen] = useState(false);
  const activeFilterCount = countActiveFilters(value);
  valueRef.current = value;
  onChangeRef.current = onChange;

  useEffect(() => {
    setQDraft(value.q);
  }, [value.q]);

  useEffect(() => {
    if (qDraft === valueRef.current.q) return;
    const timer = window.setTimeout(() => {
      onChangeRef.current({ ...valueRef.current, q: qDraft });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [qDraft]);

  useEffect(() => {
    if (!panelOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setPanelOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setPanelOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [panelOpen]);

  function patch(partial: Partial<ContentSearchFilters>) {
    onChange({ ...value, ...partial });
  }

  function clearKeyword() {
    setQDraft("");
    if (value.q) onChange({ ...value, q: "" });
  }

  function clearFilters() {
    onChange({
      ...value,
      status: "ALL",
      categorySlug: "",
      isOfficial: "",
      isFeatured: "",
      mediaKind: "",
    });
  }

  const mediaKindLabel =
    value.mediaKind === "r2"
      ? t("mediaKindR2")
      : value.mediaKind === "local"
        ? t("mediaKindLocal")
        : value.mediaKind === "online"
          ? t("mediaKindOnline")
          : "";

  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (value.status && value.status !== "ALL") {
    chips.push({
      key: "status",
      label: `${t("status")}: ${statusLabel(t, value.status)}`,
      clear: () => patch({ status: "ALL" }),
    });
  }
  if (value.categorySlug) {
    const category = categories.find((item) => item.slug === value.categorySlug);
    chips.push({
      key: "category",
      label: `${t("category")}: ${category?.nameZh || category?.nameEn || value.categorySlug}`,
      clear: () => patch({ categorySlug: "" }),
    });
  }
  if (value.mediaKind && mediaKindLabel) {
    chips.push({
      key: "mediaKind",
      label: `${t("mediaKindFilter")}: ${mediaKindLabel}`,
      clear: () => patch({ mediaKind: "" }),
    });
  }
  if (value.isOfficial) {
    chips.push({
      key: "isOfficial",
      label: `${t("official")}: ${value.isOfficial === "1" ? t("yes") : t("no")}`,
      clear: () => patch({ isOfficial: "" }),
    });
  }
  if (value.isFeatured) {
    chips.push({
      key: "isFeatured",
      label: `${t("featuredFlag")}: ${value.isFeatured === "1" ? t("yes") : t("no")}`,
      clear: () => patch({ isFeatured: "" }),
    });
  }

  return (
    <div ref={rootRef} className="mb-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle"
            aria-hidden
          />
          <Input
            className="h-10 w-full pl-9 pr-9"
            placeholder={t("searchTitleSlugCreator")}
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            aria-label={t("search")}
          />
          {qDraft ? (
            <button
              type="button"
              className="absolute right-2 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-ink-subtle hover:bg-white/60 hover:text-ink"
              onClick={clearKeyword}
              aria-label={t("close")}
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>

        <div
          className="inline-flex h-10 items-center rounded-xl border border-white/70 bg-white/55 p-0.5 shadow-[inset_0_1px_2px_rgba(15,20,25,0.04)] backdrop-blur-md"
          role="group"
          aria-label={t("sortBy")}
        >
          {(
            [
              ["weight", t("sortByWeight")],
              ["latest", t("sortByLatest")],
            ] as const
          ).map(([key, label]) => {
            const active = value.sort === key;
            return (
              <button
                key={key}
                type="button"
                className={`h-9 rounded-[0.65rem] px-3 text-body-sm font-medium transition ${
                  active
                    ? "bg-brand text-white shadow-brand"
                    : "text-ink-muted hover:bg-white/55 hover:text-ink"
                }`}
                aria-pressed={active}
                onClick={() => {
                  if (!active) patch({ sort: key });
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="relative">
          <Button
            size="sm"
            variant={panelOpen || activeFilterCount > 0 ? "secondary" : "ghost"}
            className="h-10"
            aria-expanded={panelOpen}
            aria-controls={panelId}
            onClick={() => setPanelOpen((open) => !open)}
          >
            <Filter className="size-4" />
            {t("filter")}
            {activeFilterCount > 0 ? (
              <Badge tone="info" className="ml-0.5">
                {t("filtersActive", { n: activeFilterCount })}
              </Badge>
            ) : null}
          </Button>

          {panelOpen ? (
            <div
              id={panelId}
              className="absolute right-0 z-30 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-white/70 bg-white/90 p-3 shadow-lg backdrop-blur-xl"
              role="dialog"
              aria-label={t("filter")}
            >
              <div className="space-y-3">
                <label className="block space-y-1">
                  <span className="text-caption font-medium text-ink-muted">{t("status")}</span>
                  <Select
                    value={value.status}
                    onChange={(e) => patch({ status: e.target.value })}
                  >
                    {statuses.map((status) => (
                      <option key={status} value={status}>
                        {status === "ALL" ? t("all") : statusLabel(t, status)}
                      </option>
                    ))}
                  </Select>
                </label>

                <label className="block space-y-1">
                  <span className="text-caption font-medium text-ink-muted">{t("category")}</span>
                  <Select
                    value={value.categorySlug}
                    onChange={(e) => patch({ categorySlug: e.target.value })}
                  >
                    <option value="">{t("allCategories")}</option>
                    {categories.map((category) => (
                      <option key={category.slug} value={category.slug}>
                        {category.nameZh || category.nameEn}
                      </option>
                    ))}
                  </Select>
                </label>

                <label className="block space-y-1">
                  <span className="text-caption font-medium text-ink-muted">{t("mediaKindFilter")}</span>
                  <Select
                    value={value.mediaKind}
                    onChange={(e) => patch({ mediaKind: e.target.value })}
                  >
                    <option value="">{t("mediaKindAll")}</option>
                    <option value="r2">{t("mediaKindR2")}</option>
                    <option value="local">{t("mediaKindLocal")}</option>
                    <option value="online">{t("mediaKindOnline")}</option>
                  </Select>
                </label>

                <label className="block space-y-1">
                  <span className="text-caption font-medium text-ink-muted">{t("official")}</span>
                  <Select
                    value={value.isOfficial}
                    onChange={(e) => patch({ isOfficial: e.target.value })}
                  >
                    <option value="">{t("all")}</option>
                    <option value="1">{t("yes")}</option>
                    <option value="0">{t("no")}</option>
                  </Select>
                </label>

                <label className="block space-y-1">
                  <span className="text-caption font-medium text-ink-muted">{t("featuredFlag")}</span>
                  <Select
                    value={value.isFeatured}
                    onChange={(e) => patch({ isFeatured: e.target.value })}
                  >
                    <option value="">{t("all")}</option>
                    <option value="1">{t("yes")}</option>
                    <option value="0">{t("no")}</option>
                  </Select>
                </label>

                {activeFilterCount > 0 ? (
                  <Button size="sm" variant="ghost" className="w-full" onClick={clearFilters}>
                    {t("clearFilters")}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        {showAdd && onAdd ? (
          <Button size="sm" variant="secondary" className="h-10" onClick={onAdd}>
            <Plus className="size-4" />
            {t("contentAdd")}
          </Button>
        ) : null}
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-white/60 bg-white/45 px-2 py-1 text-caption text-ink-muted transition hover:border-brand/30 hover:bg-white/70 hover:text-ink"
              onClick={chip.clear}
            >
              <span>{chip.label}</span>
              <X className="size-3 opacity-70" aria-hidden />
            </button>
          ))}
          <button
            type="button"
            className="px-1.5 text-caption text-brand hover:underline"
            onClick={clearFilters}
          >
            {t("clearFilters")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

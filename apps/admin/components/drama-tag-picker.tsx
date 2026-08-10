"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminCreateDramaTag,
  adminListDramaTags,
  type AdminDramaTagRow,
} from "@velvet/api-client";
import { useI18n } from "@/lib/i18n";
import { MAX_DRAMA_TAGS } from "@/lib/drama-tags";
import { useEffect, useMemo, useRef, useState } from "react";

const HOT_LIMIT = 10;
const MAX_TAG_LEN = 12;
const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;

function hasCjk(s: string) {
  return CJK_RE.test(s);
}

function tagLabel(row: AdminDramaTagRow, locale: string) {
  if (locale === "zh") return (row.nameZh || row.nameEn || row.tag).trim() || row.tag;
  return (row.nameEn || row.tag).trim() || row.tag;
}

function matchesQuery(row: AdminDramaTagRow, q: string) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    row.tag.toLowerCase().includes(needle) ||
    row.nameEn.toLowerCase().includes(needle) ||
    (row.nameZh || "").toLowerCase().includes(needle) ||
    (row.nameFr || "").toLowerCase().includes(needle)
  );
}

function findExact(rows: AdminDramaTagRow[], raw: string) {
  const needle = raw.trim().toLowerCase();
  if (!needle) return null;
  return (
    rows.find((r) => r.tag.toLowerCase() === needle) ||
    rows.find((r) => r.nameEn.toLowerCase() === needle) ||
    rows.find((r) => (r.nameZh || "").toLowerCase() === needle) ||
    rows.find((r) => (r.nameFr || "").toLowerCase() === needle) ||
    null
  );
}

export function DramaTagPicker({
  value,
  onChange,
  max = MAX_DRAMA_TAGS,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  max?: number;
  disabled?: boolean;
}) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["admin", "drama-tags"],
    queryFn: () => adminListDramaTags(),
    staleTime: 30_000,
  });

  const catalog = listQ.data ?? [];
  const selectedSet = useMemo(() => new Set(value.map((v) => v.toLowerCase())), [value]);
  const query = input.trim();

  const suggestions = useMemo(() => {
    return catalog
      .filter((row) => !selectedSet.has(row.tag.toLowerCase()))
      .filter((row) => matchesQuery(row, query))
      .slice(0, 12);
  }, [catalog, selectedSet, query]);

  const hotTags = useMemo(() => {
    return catalog
      .filter((row) => !selectedSet.has(row.tag.toLowerCase()) && row.count > 0)
      .slice(0, HOT_LIMIT);
  }, [catalog, selectedSet]);

  const exact = useMemo(() => findExact(catalog, query), [catalog, query]);
  const canCreate =
    !!query &&
    query.length <= MAX_TAG_LEN &&
    value.length < max &&
    !exact &&
    !selectedSet.has(query.toLowerCase());

  const menuItems = useMemo(() => {
    const rows: Array<{ kind: "tag"; row: AdminDramaTagRow } | { kind: "create"; text: string }> =
      suggestions.map((row) => ({ kind: "tag" as const, row }));
    if (canCreate) rows.push({ kind: "create", text: query });
    return rows;
  }, [suggestions, canCreate, query]);

  useEffect(() => {
    setHighlight(0);
  }, [query, open, menuItems.length]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const createMut = useMutation({
    mutationFn: async (raw: string) => {
      const nameEn = raw.trim();
      if (!nameEn) throw new Error(t("dramaTagNameRequired"));
      return adminCreateDramaTag({
        nameEn,
        nameZh: hasCjk(nameEn) ? nameEn : null,
        nameFr: null,
      });
    },
    onSuccess: async (_data, raw) => {
      await qc.invalidateQueries({ queryKey: ["admin", "drama-tags"] });
      const key = raw.trim();
      if (!selectedSet.has(key.toLowerCase()) && value.length < max) {
        onChange([...value, key]);
      }
      setInput("");
      setLocalError(null);
      setOpen(false);
    },
    onError: (e: Error) => {
      setLocalError(e.message || t("dramaTagCreateFailed"));
    },
  });

  function addTagKey(key: string) {
    const next = key.trim();
    if (!next || value.length >= max) return;
    if (selectedSet.has(next.toLowerCase())) return;
    const existing = findExact(catalog, next);
    const resolved = existing?.tag || next;
    if (selectedSet.has(resolved.toLowerCase())) return;
    onChange([...value, resolved]);
    setInput("");
    setLocalError(null);
    setOpen(false);
    inputRef.current?.focus();
  }

  function removeTag(tag: string) {
    onChange(value.filter((item) => item !== tag));
  }

  function commitInput() {
    const raw = query;
    if (!raw) return;
    if (value.length >= max) {
      setLocalError(t("dramaTagsTooMany"));
      return;
    }
    const existing = findExact(catalog, raw);
    if (existing) {
      addTagKey(existing.tag);
      return;
    }
    if (selectedSet.has(raw.toLowerCase())) {
      setInput("");
      return;
    }
    createMut.mutate(raw);
  }

  function onPickMenuIndex(idx: number) {
    const item = menuItems[idx];
    if (!item) return;
    if (item.kind === "tag") addTagKey(item.row.tag);
    else createMut.mutate(item.text);
  }

  const showMenu = open && (query ? menuItems.length > 0 : hotTags.length > 0 || listQ.isFetching);
  const labelForSelected = (tag: string) => {
    const row = catalog.find((r) => r.tag.toLowerCase() === tag.toLowerCase());
    return row ? tagLabel(row, locale) : tag;
  };

  return (
    <div ref={rootRef} className="relative space-y-2">
      <div
        className="flex flex-wrap gap-1.5 rounded-md border border-line bg-surface px-2 py-1.5"
        onClick={() => {
          if (!disabled) {
            inputRef.current?.focus();
            setOpen(true);
          }
        }}
      >
        {value.map((tag) => (
          <button
            type="button"
            key={tag}
            disabled={disabled}
            className="rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand disabled:opacity-50"
            onClick={(e) => {
              e.stopPropagation();
              removeTag(tag);
            }}
            title={tag}
          >
            {labelForSelected(tag)} ×
          </button>
        ))}
        <input
          ref={inputRef}
          className="min-w-24 flex-1 bg-transparent text-sm outline-none disabled:opacity-50"
          value={input}
          maxLength={MAX_TAG_LEN}
          disabled={disabled || createMut.isPending || value.length >= max}
          placeholder={value.length >= max ? t("dramaTagsTooMany") : t("dramaTagsPlaceholder")}
          onChange={(e) => {
            setInput(e.target.value);
            setLocalError(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              return;
            }
            if (e.key === "Backspace" && !input && value.length) {
              removeTag(value[value.length - 1]!);
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              if (menuItems.length) setHighlight((h) => (h + 1) % menuItems.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              if (menuItems.length) setHighlight((h) => (h - 1 + menuItems.length) % menuItems.length);
              return;
            }
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              if (open && menuItems.length && query) {
                onPickMenuIndex(highlight);
              } else {
                commitInput();
              }
            }
          }}
        />
      </div>

      {!query && hotTags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-ink-subtle">{t("dramaTagsHot")}</span>
          {hotTags.map((row) => (
            <button
              key={row.tag}
              type="button"
              disabled={disabled || value.length >= max}
              className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] text-ink hover:border-brand/40 hover:text-brand disabled:opacity-50"
              onClick={() => addTagKey(row.tag)}
            >
              {tagLabel(row, locale)}
              {row.count > 0 ? <span className="ml-1 text-ink-subtle">{row.count}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {showMenu && query ? (
        <ul
          className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-md border border-line bg-surface py-1 shadow-lg"
          role="listbox"
        >
          {menuItems.map((item, idx) => {
            const active = idx === highlight;
            if (item.kind === "create") {
              return (
                <li key="__create">
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`flex w-full items-center px-3 py-2 text-left text-sm ${
                      active ? "bg-brand/10 text-brand" : "text-ink hover:bg-surface-2"
                    }`}
                    onMouseEnter={() => setHighlight(idx)}
                    onClick={() => createMut.mutate(item.text)}
                    disabled={createMut.isPending}
                  >
                    {t("dramaTagsCreateAdd", { tag: item.text })}
                  </button>
                </li>
              );
            }
            return (
              <li key={item.row.tag}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${
                    active ? "bg-brand/10 text-brand" : "text-ink hover:bg-surface-2"
                  }`}
                  onMouseEnter={() => setHighlight(idx)}
                  onClick={() => addTagKey(item.row.tag)}
                >
                  <span className="min-w-0 truncate">{tagLabel(item.row, locale)}</span>
                  <span className="shrink-0 tabular-nums text-[11px] text-ink-subtle">{item.row.count}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {localError ? <p className="text-xs text-danger">{localError}</p> : null}
      {listQ.isError ? (
        <p className="text-xs text-danger">{(listQ.error as Error).message || t("dramaTagsLoadFailed")}</p>
      ) : null}
    </div>
  );
}

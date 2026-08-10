"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminCreateDramaTag,
  adminDeleteDramaTag,
  adminListDramaTags,
  adminUpdateDramaTag,
  type AdminDramaTagRow,
} from "@velvet/api-client";
import { Button, DataTable, Input, type Column } from "@velvet/ui";
import { useI18n } from "@/lib/i18n";
import { useMemo, useState } from "react";

type FormState = {
  tag?: string;
  nameEn: string;
  nameZh: string;
  nameFr: string;
};

export function DramaTagsPanel() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"create" | "edit" | null>(null);
  const [form, setForm] = useState<FormState>({ nameEn: "", nameZh: "", nameFr: "" });

  const listQ = useQuery({
    queryKey: ["admin", "drama-tags"],
    queryFn: () => adminListDramaTags(),
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const nameEn = form.nameEn.trim();
      if (!nameEn) throw new Error(t("dramaTagNameRequired"));
      if (mode === "create") {
        return adminCreateDramaTag({
          nameEn,
          nameZh: form.nameZh.trim() || null,
          nameFr: form.nameFr.trim() || null,
        });
      }
      const tag = (form.tag || "").trim();
      if (!tag) throw new Error(t("dramaTagNameRequired"));
      return adminUpdateDramaTag({
        tag,
        nameEn,
        nameZh: form.nameZh.trim() || null,
        nameFr: form.nameFr.trim() || null,
      });
    },
    onSuccess: async () => {
      setMode(null);
      setForm({ nameEn: "", nameZh: "", nameFr: "" });
      setErr(null);
      await qc.invalidateQueries({ queryKey: ["admin", "drama-tags"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (tag: string) => adminDeleteDramaTag(tag),
    onSuccess: async () => {
      setErr(null);
      await qc.invalidateQueries({ queryKey: ["admin", "drama-tags"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const columns: Column<AdminDramaTagRow>[] = useMemo(
    () => [
      {
        key: "nameEn",
        header: t("dramaTagColEn"),
        cell: (r) => r.nameEn || r.tag,
      },
      {
        key: "nameZh",
        header: t("dramaTagColZh"),
        cell: (r) => r.nameZh || "—",
      },
      {
        key: "nameFr",
        header: t("dramaTagColFr"),
        cell: (r) => r.nameFr || "—",
      },
      {
        key: "count",
        header: t("dramaTagDramaCount"),
        cell: (r) => String(r.count),
        className: "tabular-nums",
      },
      {
        key: "actions",
        header: t("actions"),
        cell: (r) => (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setMode("edit");
                setForm({
                  tag: r.tag,
                  nameEn: r.nameEn || r.tag,
                  nameZh: r.nameZh || "",
                  nameFr: r.nameFr || "",
                });
                setErr(null);
              }}
            >
              {t("dramaTagEdit")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                if (window.confirm(t("confirmDeleteDramaTag", { tag: r.nameEn || r.tag, n: r.count }))) {
                  deleteMut.mutate(r.tag);
                }
              }}
            >
              {t("delete")}
            </Button>
          </div>
        ),
      },
    ],
    [t, deleteMut],
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-body-sm text-ink-muted">{t("dramaTagsHint")}</p>
        <Button
          size="sm"
          className="shrink-0"
          onClick={() => {
            setMode("create");
            setForm({ nameEn: "", nameZh: "", nameFr: "" });
            setErr(null);
          }}
        >
          {t("dramaTagAdd")}
        </Button>
      </div>

      {err || listQ.error ? (
        <p className="mb-3 text-body-sm text-danger">{err || (listQ.error as Error).message}</p>
      ) : null}

      {mode ? (
        <div className="mb-6 grid gap-3 card glass-card p-4 md:grid-cols-4">
          <label className="text-caption text-ink-muted">
            {t("dramaTagColEn")}
            <Input
              className="mt-1"
              value={form.nameEn}
              onChange={(e) => setForm((v) => ({ ...v, nameEn: e.target.value }))}
              placeholder={t("dramaTagNameEnPh")}
            />
          </label>
          <label className="text-caption text-ink-muted">
            {t("dramaTagColZh")}
            <Input
              className="mt-1"
              value={form.nameZh}
              onChange={(e) => setForm((v) => ({ ...v, nameZh: e.target.value }))}
              placeholder={t("dramaTagNameZhPh")}
            />
          </label>
          <label className="text-caption text-ink-muted">
            {t("dramaTagColFr")}
            <Input
              className="mt-1"
              value={form.nameFr}
              onChange={(e) => setForm((v) => ({ ...v, nameFr: e.target.value }))}
              placeholder={t("dramaTagNameFrPh")}
            />
          </label>
          <div className="flex items-end gap-2">
            <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              {mode === "create" ? t("dramaTagAdd") : t("save")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setMode(null);
                setForm({ nameEn: "", nameZh: "", nameFr: "" });
              }}
            >
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : null}

      <DataTable
        columns={columns}
        rows={listQ.data ?? []}
        loading={listQ.isFetching && !listQ.data}
        emptyTitle={t("dramaTagsEmpty")}
      />
    </div>
  );
}

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminDeleteDramaTag,
  adminListDramaTags,
  adminRenameDramaTag,
  type AdminDramaTagRow,
} from "@velvet/api-client";
import { Button, DataTable, Input, type Column } from "@velvet/ui";
import { useI18n } from "@/lib/i18n";
import { useMemo, useState } from "react";

export function DramaTagsPanel() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [renameFrom, setRenameFrom] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");

  const listQ = useQuery({
    queryKey: ["admin", "drama-tags"],
    queryFn: () => adminListDramaTags(),
  });

  const renameMut = useMutation({
    mutationFn: async () => {
      const from = (renameFrom || "").trim();
      const to = renameTo.trim();
      if (!from || !to) throw new Error(t("dramaTagNameRequired"));
      return adminRenameDramaTag({ from, to });
    },
    onSuccess: async () => {
      setRenameFrom(null);
      setRenameTo("");
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
      { key: "tag", header: t("dramaTagCol"), cell: (r) => r.tag },
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
                setRenameFrom(r.tag);
                setRenameTo(r.tag);
                setErr(null);
              }}
            >
              {t("dramaTagRename")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                if (window.confirm(t("confirmDeleteDramaTag", { tag: r.tag, n: r.count }))) {
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
      {err || listQ.error ? (
        <p className="mb-3 text-body-sm text-danger">{err || (listQ.error as Error).message}</p>
      ) : null}

      <p className="mb-4 max-w-2xl text-body-sm text-ink-muted">{t("dramaTagsHint")}</p>

      {renameFrom ? (
        <div className="mb-6 grid gap-3 card glass-card p-4 md:grid-cols-3">
          <label className="text-caption text-ink-muted md:col-span-1">
            {t("dramaTagFrom")}
            <Input className="mt-1" value={renameFrom} disabled />
          </label>
          <label className="text-caption text-ink-muted md:col-span-1">
            {t("dramaTagTo")}
            <Input
              className="mt-1"
              value={renameTo}
              onChange={(e) => setRenameTo(e.target.value)}
              placeholder={t("dramaTagNamePh")}
            />
          </label>
          <div className="flex items-end gap-2">
            <Button size="sm" onClick={() => renameMut.mutate()} disabled={renameMut.isPending}>
              {t("dramaTagRename")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setRenameFrom(null);
                setRenameTo("");
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

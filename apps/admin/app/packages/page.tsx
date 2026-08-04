"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminCreatePackage, adminListPackages, adminUpdatePackage, asRows } from "@velvet/api-client";
import { topupPackageSchema } from "@velvet/validators";
import { AdminShell } from "@/components/admin-shell";
import { useI18n } from "@/lib/i18n";
import { Badge, Button, DataTable, Input, type Column } from "@velvet/ui";
import { useMemo, useState } from "react";

type Row = {
  id: string | number;
  name?: string | null;
  credits?: string | number;
  basePrice?: string | number;
  sortOrder?: number;
  active?: boolean;
};

export default function AdminPackagesPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [credits, setCredits] = useState(10);
  const [basePrice, setBasePrice] = useState(10);
  const [sortOrder, setSortOrder] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["admin", "packages"],
    queryFn: async () => asRows<Row>(await adminListPackages()),
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const parsed = topupPackageSchema.safeParse({
        name: name.trim() || undefined,
        credits,
        basePrice,
        sortOrder,
        active: true,
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || t("validateFailed"));
      return adminCreatePackage(parsed.data);
    },
    onSuccess: async () => {
      setName("");
      setErr(null);
      await qc.invalidateQueries({ queryKey: ["admin", "packages"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const toggleMut = useMutation({
    mutationFn: (row: Row) => adminUpdatePackage(String(row.id), { active: !row.active }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "packages"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const columns: Column<Row>[] = useMemo(
    () => [
      { key: "name", header: t("colName"), cell: (r) => r.name || "—" },
      { key: "credits", header: t("colCredits"), cell: (r) => String(r.credits), className: "tabular-nums" },
      { key: "price", header: t("colPriceCny"), cell: (r) => String(r.basePrice), className: "tabular-nums" },
      { key: "sort", header: t("colSort"), cell: (r) => String(r.sortOrder ?? 0), className: "tabular-nums" },
      {
        key: "active",
        header: t("status"),
        cell: (r) => <Badge tone={r.active ? "success" : "default"}>{r.active ? t("enable") : t("disable")}</Badge>,
      },
      {
        key: "actions",
        header: t("actions"),
        cell: (r) => (
          <Button size="sm" variant="secondary" onClick={() => toggleMut.mutate(r)}>
            {r.active ? t("disable") : t("enable")}
          </Button>
        ),
      },
    ],
    [t, toggleMut],
  );

  return (
    <AdminShell title={t("packages")}>
      <p className="mb-4 text-body-sm text-ink-muted">{t("packagePriceHint")}</p>
      {err || listQ.error ? (
        <p className="mb-3 text-body-sm text-danger">{err || (listQ.error as Error).message}</p>
      ) : null}

      <div className="mb-6 flex flex-wrap items-end gap-2 card glass-card p-4">
        <label className="text-caption text-ink-muted">
          {t("colName")}
          <Input className="mt-1 w-32" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("packageName")} />
        </label>
        <label className="text-caption text-ink-muted">
          {t("colCredits")}
          <Input
            type="number"
            className="mt-1 w-28"
            value={credits}
            onChange={(e) => setCredits(Number(e.target.value))}
          />
        </label>
        <label className="text-caption text-ink-muted">
          {t("colPriceCny")}
          <Input
            type="number"
            step="0.01"
            className="mt-1 w-28"
            value={basePrice}
            onChange={(e) => setBasePrice(Number(e.target.value))}
          />
        </label>
        <label className="text-caption text-ink-muted">
          {t("colSort")}
          <Input
            type="number"
            className="mt-1 w-20"
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value))}
          />
        </label>
        <Button size="sm" onClick={() => createMut.mutate()} disabled={createMut.isPending}>
          {t("create")}
        </Button>
      </div>

      <DataTable columns={columns} rows={listQ.data || []} loading={listQ.isFetching} emptyTitle={t("empty")} />
    </AdminShell>
  );
}

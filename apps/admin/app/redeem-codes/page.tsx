"use client";

import { useCallback, useMemo, useState } from "react";
import { Copy, Download, Plus, RefreshCw, Ticket } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminCreateRedeemBatch,
  adminExportRedeemBatchCsv,
  adminListRedeemBatches,
  adminListRedeemCodes,
  adminListRedemptions,
  adminVoidRedeemBatch,
  adminVoidRedeemCodes,
} from "@velvet/api-client";
import { redeemBatchSchema, type RedeemBatchInput } from "@velvet/validators";
import { Badge, Button, DataTable, Input, Select, cn, fmtDate, type Column } from "@velvet/ui";
import { AdminShell } from "@/components/admin-shell";
import { ConfirmModal, GlassModal } from "@/components/glass-modal";
import { useI18n, statusLabel } from "@/lib/i18n";

type Tab = "batches" | "codes" | "redemptions";
type BatchRow = {
  id: string;
  name?: string | null;
  type: string;
  vipDays?: number | null;
  creditsAmount?: string | null;
  quantity: number;
  expiresAt?: string | null;
  note?: string | null;
  createdAt?: string;
  unused?: number;
  used?: number;
  voided?: number;
};
type CodeRow = {
  id: string;
  batchId: string;
  code?: string;
  codeHint?: string;
  type?: string;
  vipDays?: number | null;
  creditsAmount?: string | null;
  status?: string;
  usedBy?: { id?: string; email?: string | null; nickname?: string | null; username?: string | null } | null;
  usedAt?: string | null;
  expiresAt?: string | null;
  createdAt?: string;
};
type RedemptionRow = {
  id: string;
  code?: string;
  codeHint?: string;
  batchId?: string;
  type?: string;
  vipDays?: number | null;
  creditsAmount?: string | null;
  orderId?: string | null;
  createdAt?: string;
  user?: { id?: string; email?: string | null; nickname?: string | null; username?: string | null };
};

const PAGE_SIZE_OPTIONS = [20, 40, 50] as const;

function paginationItems(page: number, total: number): Array<number | "ellipsis"> {
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

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const emptyForm: RedeemBatchInput = {
  name: "",
  type: "VIP",
  vipDays: 30,
  creditsAmount: 50,
  quantity: 10,
  expiresAt: "",
  note: "",
};

export default function AdminRedeemCodesPage() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const dateLocale = locale === "en" ? "en-US" : "zh-CN";

  const [tab, setTab] = useState<Tab>("batches");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [codeStatus, setCodeStatus] = useState("ALL");
  const [batchFilter, setBatchFilter] = useState("");
  const [codeQuery, setCodeQuery] = useState("");
  const [appliedCodeQuery, setAppliedCodeQuery] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<RedeemBatchInput>(emptyForm);
  const [modalError, setModalError] = useState<string | null>(null);
  const [createdCodes, setCreatedCodes] = useState<{ batchId: string; codes: string[] } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingVoidBatch, setPendingVoidBatch] = useState<BatchRow | null>(null);
  const [pendingVoidSelected, setPendingVoidSelected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const batchesQ = useQuery({
    queryKey: ["admin", "redeem", "batches", page, pageSize],
    queryFn: () => adminListRedeemBatches(page, pageSize),
    enabled: tab === "batches",
  });

  const batchOptionsQ = useQuery({
    queryKey: ["admin", "redeem", "batches", "options"],
    queryFn: () => adminListRedeemBatches(1, 100),
    enabled: tab === "codes" || tab === "redemptions" || createOpen,
  });

  const codesQ = useQuery({
    queryKey: ["admin", "redeem", "codes", { page, pageSize, codeStatus, batchFilter, appliedCodeQuery }],
    queryFn: () =>
      adminListRedeemCodes({
        page,
        pageSize,
        status: codeStatus,
        batchId: batchFilter || undefined,
        code: appliedCodeQuery || undefined,
      }),
    enabled: tab === "codes",
  });

  const redemptionsQ = useQuery({
    queryKey: ["admin", "redeem", "redemptions", { page, pageSize, batchFilter }],
    queryFn: () => adminListRedemptions({ page, pageSize, batchId: batchFilter || undefined }),
    enabled: tab === "redemptions",
  });

  const activeQ = tab === "batches" ? batchesQ : tab === "codes" ? codesQ : redemptionsQ;
  const total = activeQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const createMut = useMutation({
    mutationFn: async () => {
      const parsed = redeemBatchSchema.safeParse({
        ...form,
        name: form.name?.trim() || undefined,
        note: form.note?.trim() || undefined,
        expiresAt: form.expiresAt?.trim() || undefined,
        vipDays: form.type === "VIP" ? form.vipDays : undefined,
        creditsAmount: form.type === "CREDITS" ? form.creditsAmount : undefined,
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || t("validateFailed"));
      return adminCreateRedeemBatch({
        name: parsed.data.name,
        type: parsed.data.type,
        vipDays: parsed.data.type === "VIP" ? parsed.data.vipDays : undefined,
        creditsAmount: parsed.data.type === "CREDITS" ? parsed.data.creditsAmount : undefined,
        quantity: parsed.data.quantity,
        expiresAt: parsed.data.expiresAt
          ? new Date(parsed.data.expiresAt).toISOString()
          : undefined,
        note: parsed.data.note,
      });
    },
    onSuccess: async (result) => {
      setCreateOpen(false);
      setForm(emptyForm);
      setModalError(null);
      setCreatedCodes({ batchId: result.batchId, codes: result.codes ?? [] });
      setToast(t("redeemCreated", { n: result.quantity }));
      setTab("batches");
      setPage(1);
      await qc.invalidateQueries({ queryKey: ["admin", "redeem"] });
    },
    onError: (e: Error) => setModalError(e.message),
  });

  const voidBatchMut = useMutation({
    mutationFn: (id: string) => adminVoidRedeemBatch(id),
    onSuccess: async (res) => {
      setPendingVoidBatch(null);
      setToast(t("redeemVoided", { n: res.voided }));
      await qc.invalidateQueries({ queryKey: ["admin", "redeem"] });
    },
    onError: (e: Error) => {
      setError(e.message);
      setPendingVoidBatch(null);
    },
  });

  const voidCodesMut = useMutation({
    mutationFn: () => adminVoidRedeemCodes([...selected]),
    onSuccess: async (res) => {
      setPendingVoidSelected(false);
      setSelected(new Set());
      setToast(t("redeemVoided", { n: res.voided }));
      await qc.invalidateQueries({ queryKey: ["admin", "redeem"] });
    },
    onError: (e: Error) => {
      setError(e.message);
      setPendingVoidSelected(false);
    },
  });

  function switchTab(next: Tab) {
    setTab(next);
    setPage(1);
    setSelected(new Set());
    setError(null);
  }

  const rewardLabel = useCallback((type?: string, vipDays?: number | null, creditsAmount?: string | number | null) => {
    if (type === "VIP") return `VIP ${t("daysUnit", { n: Number(vipDays) || 0 })}`;
    if (type === "CREDITS") return t("creditsUnit", { n: Number(creditsAmount) || 0 });
    return type || "—";
  }, [t]);

  function userLabel(user?: { email?: string | null; nickname?: string | null; username?: string | null; id?: string } | null) {
    return user?.nickname || user?.username || user?.email || user?.id || "—";
  }

  async function copyCodes(codes: string[]) {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setToast(t("copied"));
    } catch {
      setError(t("copyFailed"));
    }
  }

  const batchColumns: Column<BatchRow>[] = useMemo(
    () => [
      {
        key: "batch",
        header: t("colBatch"),
        cell: (row) => (
          <div>
            <div className="font-medium text-ink">#{row.id}{row.name ? ` · ${row.name}` : ""}</div>
            {row.note ? <div className="mt-0.5 text-caption text-ink-muted line-clamp-1">{row.note}</div> : null}
          </div>
        ),
      },
      {
        key: "type",
        header: t("colType"),
        cell: (row) => rewardLabel(row.type, row.vipDays, row.creditsAmount),
      },
      { key: "qty", header: t("colQty"), cell: (row) => String(row.quantity), className: "tabular-nums" },
      {
        key: "counts",
        header: t("colUnusedUsedVoided"),
        cell: (row) => (
          <span className="tabular-nums">
            <span className="text-success">{row.unused ?? 0}</span>
            {" / "}
            <span>{row.used ?? 0}</span>
            {" / "}
            <span className="text-ink-muted">{row.voided ?? 0}</span>
          </span>
        ),
      },
      {
        key: "expires",
        header: t("colExpires"),
        cell: (row) => (row.expiresAt ? fmtDate(row.expiresAt, dateLocale) : "—"),
        className: "text-caption",
      },
      {
        key: "time",
        header: t("time"),
        cell: (row) => fmtDate(row.createdAt, dateLocale),
        className: "text-caption",
      },
      {
        key: "actions",
        header: t("actions"),
        cell: (row) => (
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setBatchFilter(row.id);
                setCodeStatus("ALL");
                setAppliedCodeQuery("");
                setCodeQuery("");
                switchTab("codes");
              }}
            >
              {t("viewCodes")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                adminExportRedeemBatchCsv(row.id).catch((e: Error) => setError(e.message))
              }
            >
              {t("exportStatusCsv")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={!row.unused}
              onClick={() => setPendingVoidBatch(row)}
            >
              {t("voidUnused")}
            </Button>
          </div>
        ),
      },
    ],
    [t, dateLocale, rewardLabel],
  );

  const codeColumns: Column<CodeRow>[] = useMemo(
    () => [
      {
        key: "select",
        header: "",
        cell: (row) => (
          <input
            type="checkbox"
            disabled={row.status !== "UNUSED"}
            checked={selected.has(row.id)}
            onChange={(e) =>
              setSelected((old) => {
                const next = new Set(old);
                if (e.target.checked) next.add(row.id);
                else next.delete(row.id);
                return next;
              })
            }
          />
        ),
      },
      {
        key: "code",
        header: t("colCode"),
        cell: (row) => <span className="font-mono text-caption">{row.codeHint || row.code || "—"}</span>,
      },
      { key: "batch", header: t("colBatch"), cell: (row) => `#${row.batchId}` },
      {
        key: "reward",
        header: t("colContent"),
        cell: (row) => rewardLabel(row.type, row.vipDays, row.creditsAmount),
      },
      {
        key: "status",
        header: t("status"),
        cell: (row) => {
          const tone = row.status === "UNUSED" ? "success" : row.status === "USED" ? "info" : "warning";
          return <Badge tone={tone as "success" | "info" | "warning"}>{statusLabel(t, row.status)}</Badge>;
        },
      },
      {
        key: "user",
        header: t("colUser"),
        cell: (row) => userLabel(row.usedBy),
      },
      {
        key: "usedAt",
        header: t("colUsedAt"),
        cell: (row) => (row.usedAt ? fmtDate(row.usedAt, dateLocale) : "—"),
        className: "text-caption",
      },
      {
        key: "expires",
        header: t("colExpires"),
        cell: (row) => (row.expiresAt ? fmtDate(row.expiresAt, dateLocale) : "—"),
        className: "text-caption",
      },
    ],
    [t, dateLocale, selected, rewardLabel],
  );

  const redemptionColumns: Column<RedemptionRow>[] = useMemo(
    () => [
      {
        key: "code",
        header: t("colCode"),
        cell: (row) => <span className="font-mono text-caption">{row.codeHint || row.code || "—"}</span>,
      },
      { key: "batch", header: t("colBatch"), cell: (row) => (row.batchId ? `#${row.batchId}` : "—") },
      { key: "user", header: t("colUser"), cell: (row) => userLabel(row.user) },
      {
        key: "type",
        header: t("colContent"),
        cell: (row) => rewardLabel(row.type, row.vipDays, row.creditsAmount),
      },
      {
        key: "order",
        header: t("colOrderNo"),
        cell: (row) => row.orderId || "—",
        className: "font-mono text-caption",
      },
      {
        key: "time",
        header: t("time"),
        cell: (row) => fmtDate(row.createdAt, dateLocale),
        className: "text-caption",
      },
    ],
    [t, dateLocale, rewardLabel],
  );

  const batchOptions = batchOptionsQ.data?.rows ?? [];

  return (
    <AdminShell title={t("redeemCodes")}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-body-sm text-ink-muted">{t("redeemHint")}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="cursor-pointer hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.97]"
            onClick={() => {
              setForm(emptyForm);
              setModalError(null);
              setCreateOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            {t("generate")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="cursor-pointer hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed"
            disabled={activeQ.isFetching}
            onClick={() => {
              setToast(null);
              void activeQ.refetch();
            }}
          >
            <RefreshCw className={`h-4 w-4 ${activeQ.isFetching ? "animate-spin" : ""}`} />
            {t("refresh")}
          </Button>
        </div>
      </div>

      {toast ? (
        <div className="mb-4 rounded-xl border border-success/20 bg-success-soft px-3 py-2 text-body-sm text-success">
          {toast}
        </div>
      ) : null}
      {error || activeQ.error ? (
        <div className="mb-4 rounded-xl border border-danger/20 bg-danger-soft px-3 py-2 text-body-sm text-danger">
          {error || (activeQ.error as Error)?.message}
        </div>
      ) : null}

      {createdCodes ? (
        <div className="mb-5 rounded-2xl border border-amber-200/80 bg-amber-50/80 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold text-ink">{t("plaintextCodesTitle")}</p>
              <p className="mt-0.5 text-caption text-ink-muted">{t("plaintextCodesOnce")}</p>
            </div>
            <Badge tone="warning">#{createdCodes.batchId}</Badge>
          </div>
          <textarea
            readOnly
            className="h-36 w-full rounded-xl border border-line bg-white p-3 font-mono text-caption"
            value={createdCodes.codes.join("\n")}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => void copyCodes(createdCodes.codes)}>
              <Copy className="h-4 w-4" />
              {t("copyAll")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                downloadTextFile(
                  `redeem-batch-${createdCodes.batchId}-plaintext.csv`,
                  `code\n${createdCodes.codes.join("\n")}\n`,
                )
              }
            >
              <Download className="h-4 w-4" />
              {t("downloadPlaintextCsv")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCreatedCodes(null)}>
              {t("close")}
            </Button>
          </div>
        </div>
      ) : null}

      <div
        role="tablist"
        aria-label={t("redeemCodes")}
        className="mb-4 inline-flex w-full max-w-xl rounded-2xl border border-slate-200/80 bg-white/80 p-1 shadow-[0_4px_18px_rgba(15,23,42,0.04)]"
      >
        {(
          [
            ["batches", t("tabBatches")],
            ["codes", t("tabCodes")],
            ["redemptions", t("tabRedemptions")],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition",
              tab === key
                ? "bg-brand text-white shadow-brand"
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-800",
            )}
            onClick={() => switchTab(key)}
          >
            {key === "batches" ? <Ticket className="h-4 w-4" aria-hidden="true" /> : null}
            {label}
          </button>
        ))}
      </div>

      {tab === "codes" || tab === "redemptions" ? (
        <div className="mb-4 flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-white/50 p-3">
          <label className="block text-caption font-medium text-ink-muted">
            {t("colBatch")}
            <Select
              className="mt-1 w-44"
              value={batchFilter}
              onChange={(e) => {
                setBatchFilter(e.target.value);
                setPage(1);
                setSelected(new Set());
              }}
            >
              <option value="">{t("allBatches")}</option>
              {batchOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  #{b.id}{b.name ? ` ${b.name}` : ""} · {rewardLabel(b.type, b.vipDays, b.creditsAmount)}
                </option>
              ))}
            </Select>
          </label>
          {tab === "codes" ? (
            <>
              <label className="block text-caption font-medium text-ink-muted">
                {t("status")}
                <Select
                  className="mt-1 w-36"
                  value={codeStatus}
                  onChange={(e) => {
                    setCodeStatus(e.target.value);
                    setPage(1);
                    setSelected(new Set());
                  }}
                >
                  <option value="ALL">{t("statusAll")}</option>
                  <option value="UNUSED">{statusLabel(t, "UNUSED")}</option>
                  <option value="USED">{statusLabel(t, "USED")}</option>
                  <option value="VOID">{statusLabel(t, "VOID")}</option>
                </Select>
              </label>
              <label className="block min-w-[14rem] flex-1 text-caption font-medium text-ink-muted">
                {t("colCode")}
                <Input
                  className="mt-1"
                  value={codeQuery}
                  placeholder={t("redeemCodeSearchPlaceholder")}
                  onChange={(e) => setCodeQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setAppliedCodeQuery(codeQuery.trim());
                      setPage(1);
                    }
                  }}
                />
              </label>
              <Button
                size="sm"
                onClick={() => {
                  setAppliedCodeQuery(codeQuery.trim());
                  setPage(1);
                }}
              >
                {t("query")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setBatchFilter("");
                  setCodeStatus("ALL");
                  setCodeQuery("");
                  setAppliedCodeQuery("");
                  setPage(1);
                  setSelected(new Set());
                }}
              >
                {t("clearFilters")}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      {tab === "codes" ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="danger"
            disabled={!selected.size || voidCodesMut.isPending}
            onClick={() => setPendingVoidSelected(true)}
          >
            {t("voidSelected", { n: selected.size })}
          </Button>
          <span className="text-caption text-ink-muted">{t("redeemMaskedHint")}</span>
        </div>
      ) : null}

      {tab === "batches" ? (
        <DataTable
          columns={batchColumns}
          rows={batchesQ.data?.rows ?? []}
          loading={batchesQ.isFetching}
          emptyTitle={t("empty")}
          getRowKey={(r) => r.id}
        />
      ) : null}
      {tab === "codes" ? (
        <DataTable
          columns={codeColumns}
          rows={codesQ.data?.rows ?? []}
          loading={codesQ.isFetching}
          emptyTitle={t("empty")}
          getRowKey={(r) => r.id}
        />
      ) : null}
      {tab === "redemptions" ? (
        <DataTable
          columns={redemptionColumns}
          rows={redemptionsQ.data?.rows ?? []}
          loading={redemptionsQ.isFetching}
          emptyTitle={t("empty")}
          getRowKey={(r) => r.id}
        />
      ) : null}

      {total > 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white/45 px-3 py-2 text-caption text-ink-muted">
          <div className="flex items-center gap-3">
            <span>{t("totalCount", { n: total })}</span>
            <Select
              className="h-8 w-28 text-caption"
              value={String(pageSize)}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} / {t("page")}
                </option>
              ))}
            </Select>
            <span>
              {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} / {total}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="secondary" disabled={page <= 1 || activeQ.isFetching} onClick={() => setPage(page - 1)}>
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
                    disabled={activeQ.isFetching}
                    onClick={() => setPage(item)}
                    className={cn(
                      "grid h-9 min-w-9 place-items-center rounded-xl px-2 font-medium transition",
                      item === page
                        ? "bg-brand text-white shadow-brand"
                        : "border border-white/70 bg-white/65 text-ink-muted hover:-translate-y-0.5 hover:bg-white hover:text-ink hover:shadow-sm",
                    )}
                  >
                    {item}
                  </button>
                ),
              )}
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={page >= totalPages || activeQ.isFetching}
              onClick={() => setPage(page + 1)}
            >
              {t("nextPage")}
            </Button>
          </div>
        </div>
      ) : null}

      <GlassModal
        open={createOpen}
        onClose={() => {
          if (!createMut.isPending) setCreateOpen(false);
        }}
        size="md"
        title={
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand text-white shadow-brand">
              <Ticket className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-lg font-bold tracking-tight text-slate-900">{t("generateBatch")}</span>
              <span className="mt-0.5 block text-xs font-normal text-slate-500">{t("redeemHintShort")}</span>
            </span>
          </div>
        }
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!createMut.isPending) createMut.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-slate-700 sm:col-span-2">
              {t("batchName")}
              <span className="ml-1 font-normal text-slate-400">({t("optional")})</span>
              <Input
                className="mt-1.5"
                value={form.name || ""}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                maxLength={120}
              />
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              {t("colType")}
              <Select
                className="mt-1.5"
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as "VIP" | "CREDITS" }))}
              >
                <option value="VIP">VIP</option>
                <option value="CREDITS">{t("colCredits")}</option>
              </Select>
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              {form.type === "VIP" ? t("colDays") : t("colCredits")}
              <Input
                className="mt-1.5"
                type="number"
                min={1}
                required
                value={form.type === "VIP" ? form.vipDays ?? "" : form.creditsAmount ?? ""}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    [form.type === "VIP" ? "vipDays" : "creditsAmount"]: Number(e.target.value),
                  }))
                }
              />
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              {t("colQty")}
              <Input
                className="mt-1.5"
                type="number"
                min={1}
                max={5000}
                required
                value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: Number(e.target.value) }))}
              />
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              {t("colExpires")}
              <span className="ml-1 font-normal text-slate-400">({t("optional")})</span>
              <Input
                className="mt-1.5"
                type="datetime-local"
                value={form.expiresAt || ""}
                onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
              />
            </label>
            <label className="block text-xs font-semibold text-slate-700 sm:col-span-2">
              {t("colNote")}
              <span className="ml-1 font-normal text-slate-400">({t("optional")})</span>
              <Input
                className="mt-1.5"
                value={form.note || ""}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                maxLength={500}
                placeholder={t("redeemNotePlaceholder")}
              />
            </label>
          </div>

          {modalError ? (
            <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {modalError}
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={createMut.isPending}
              onClick={() => setCreateOpen(false)}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={createMut.isPending}>
              {createMut.isPending ? t("saving") : t("generate")}
            </Button>
          </div>
        </form>
      </GlassModal>

      <ConfirmModal
        open={Boolean(pendingVoidBatch)}
        onClose={() => setPendingVoidBatch(null)}
        onConfirm={() => {
          if (pendingVoidBatch) voidBatchMut.mutate(pendingVoidBatch.id);
        }}
        message={t("confirmVoidBatch", {
          id: pendingVoidBatch?.id || "",
          n: pendingVoidBatch?.unused ?? 0,
        })}
        confirmVariant="danger"
        busy={voidBatchMut.isPending}
      />

      <ConfirmModal
        open={pendingVoidSelected}
        onClose={() => setPendingVoidSelected(false)}
        onConfirm={() => voidCodesMut.mutate()}
        message={t("confirmVoidSelected", { n: selected.size })}
        confirmVariant="danger"
        busy={voidCodesMut.isPending}
      />
    </AdminShell>
  );
}

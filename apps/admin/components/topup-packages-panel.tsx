"use client";

import { useMemo, useRef, useState } from "react";
import { CircleDollarSign, Coins, Gift, GripVertical, Plus, RefreshCw, Tag } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminCreateTopupPackage,
  adminDeleteTopupPackage,
  adminListTopupPackages,
  adminUpdateTopupPackage,
  asRows,
} from "@velvet/api-client";
import { topupPackageSchema, type TopupPackageInput } from "@velvet/validators";
import { Badge, Button, EmptyState, Input, Select } from "@velvet/ui";
import { ConfirmModal, GlassModal } from "@/components/glass-modal";
import {
  TopupPackageAdminList,
  type TopupPackageListModel,
} from "@/components/topup-package-list";
import {
  shouldApplySuggestedBadge,
  suggestTopupBonusBadge,
} from "@/lib/badge-suggest";
import { useI18n } from "@/lib/i18n";

type Pkg = TopupPackageListModel;
type StatusFilter = "all" | "active" | "archived";

const emptyForm: TopupPackageInput = {
  name: "",
  baseCredits: 300,
  bonusCredits: 0,
  basePrice: 2.99,
  sortOrder: 0,
  badge: "",
  active: true,
};

export function TopupPackagesPanel() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [form, setForm] = useState<TopupPackageInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingToggle, setPendingToggle] = useState<Pkg | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Pkg | null>(null);
  const lastAutoBadgeRef = useRef("");

  const listQ = useQuery({
    queryKey: ["admin", "topup-packages"],
    queryFn: async () => asRows<Pkg>(await adminListTopupPackages()),
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const parsed = topupPackageSchema.safeParse(form);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || t("validateFailed"));
      const payload = {
        ...parsed.data,
        name: parsed.data.name?.trim() || undefined,
        badge: parsed.data.badge?.trim() || undefined,
        bonusCredits: parsed.data.bonusCredits ?? 0,
      };
      return editingId
        ? adminUpdateTopupPackage(editingId, payload)
        : adminCreateTopupPackage(payload);
    },
    onSuccess: async () => {
      const wasEditing = Boolean(editingId);
      closeModal();
      setToast(wasEditing ? t("topupPkgUpdated") : t("topupPkgCreated"));
      await qc.invalidateQueries({ queryKey: ["admin", "topup-packages"] });
    },
    onError: (e: Error) => setModalError(e.message),
  });

  const toggleMut = useMutation({
    mutationFn: (pkg: Pkg) => adminUpdateTopupPackage(pkg.id, { active: !pkg.active }),
    onSuccess: async (_data, pkg) => {
      const name = pkg.name || pkg.id;
      setToast(pkg.active ? t("topupPkgOffShelved", { name }) : t("topupPkgOnShelved", { name }));
      setPendingToggle(null);
      if (editingId === pkg.id) closeModal();
      await qc.invalidateQueries({ queryKey: ["admin", "topup-packages"] });
    },
    onError: (e: Error) => {
      setError(e.message);
      setPendingToggle(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (pkg: Pkg) => adminDeleteTopupPackage(pkg.id),
    onSuccess: async (_data, pkg) => {
      const name = pkg.name || pkg.id;
      setToast(t("topupPkgDeleted", { name }));
      setPendingDelete(null);
      if (editingId === pkg.id) closeModal();
      await qc.invalidateQueries({ queryKey: ["admin", "topup-packages"] });
    },
    onError: (e: Error) => {
      setError(e.message);
      setPendingDelete(null);
    },
  });

  const rows = listQ.data ?? [];
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows
      .filter((pkg) => {
        if (statusFilter === "active" && !pkg.active) return false;
        if (statusFilter === "archived" && pkg.active) return false;
        if (!needle) return true;
        return (
          String(pkg.id).includes(needle) ||
          String(pkg.name || "").toLowerCase().includes(needle) ||
          String(pkg.credits).includes(needle) ||
          String(pkg.baseCredits || "").includes(needle) ||
          String(pkg.badge || "").toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => {
        const orderA = Number(a.sortOrder) || 0;
        const orderB = Number(b.sortOrder) || 0;
        if (orderA !== orderB) return orderA - orderB;
        return String(a.id).localeCompare(String(b.id));
      });
  }, [rows, search, statusFilter]);

  const totalCredits =
    Math.max(0, Number(form.baseCredits) || 0) + Math.max(0, Number(form.bonusCredits) || 0);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    lastAutoBadgeRef.current = "";
    setModalError(null);
    setError(null);
    setModalOpen(true);
  }

  function openEdit(pkg: Pkg) {
    const next: TopupPackageInput = {
      name: pkg.name || "",
      baseCredits: Number(pkg.baseCredits ?? pkg.credits) || 1,
      bonusCredits: Number(pkg.bonusCredits ?? 0) || 0,
      basePrice: Number(pkg.basePrice) || 0.01,
      sortOrder: Number(pkg.sortOrder) || 0,
      badge: pkg.badge || "",
      active: !!pkg.active,
    };
    const suggested = suggestTopupBonusBadge(next.baseCredits, next.bonusCredits ?? 0);
    lastAutoBadgeRef.current = (next.badge || "").trim() === suggested ? suggested : "";
    setEditingId(pkg.id);
    setForm(next);
    setModalError(null);
    setError(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setModalError(null);
    setEditingId(null);
    setForm(emptyForm);
    lastAutoBadgeRef.current = "";
  }

  function patchForm(patch: Partial<TopupPackageInput>, opts?: { manualBadge?: boolean }) {
    setForm((prev) => {
      const next = { ...prev, ...patch };
      if (opts?.manualBadge) return next;

      const creditsChanged = patch.baseCredits !== undefined || patch.bonusCredits !== undefined;
      if (!creditsChanged) return next;

      const suggested = suggestTopupBonusBadge(Number(next.baseCredits) || 0, Number(next.bonusCredits) || 0);
      if (shouldApplySuggestedBadge(prev.badge, lastAutoBadgeRef.current)) {
        lastAutoBadgeRef.current = suggested;
        next.badge = suggested;
      }
      return next;
    });
  }

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-body-sm text-ink-muted">{t("topupPriceHint")}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            className="cursor-pointer hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.97]"
            onClick={openCreate}
          >
            <Plus className="h-4 w-4" />
            {t("topupPkgCreate")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="cursor-pointer hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed"
            disabled={listQ.isFetching}
            onClick={() => {
              setToast(null);
              void listQ.refetch();
            }}
          >
            <RefreshCw className={`h-4 w-4 ${listQ.isFetching ? "animate-spin" : ""}`} />
            {t("refresh")}
          </Button>
        </div>
      </div>

      {toast ? (
        <div className="mb-4 rounded-xl border border-success/20 bg-success-soft px-3 py-2 text-body-sm text-success">
          {toast}
        </div>
      ) : null}
      {error || listQ.error ? (
        <div className="mb-4 rounded-xl border border-danger/20 bg-danger-soft px-3 py-2 text-body-sm text-danger">
          {error || (listQ.error as Error).message}
        </div>
      ) : null}

      <div className="admin-fill card glass-card flex min-h-0 flex-col p-4 md:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-ink">{t("topupPkgList")}</h3>
          <Badge tone={rows.some((row) => row.active) ? "success" : "warning"}>
            {t("liveCount")}: {rows.filter((row) => row.active).length}
          </Badge>
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("topupPkgSearchPlaceholder")}
          />
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="all">{t("statusAll")}</option>
            <option value="active">{t("onShelf")}</option>
            <option value="archived">{t("offShelf")}</option>
          </Select>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl">
          {listQ.isLoading ? (
            <div className="flex min-h-full items-center justify-center">
              <EmptyState title={t("loading")} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex min-h-full items-center justify-center">
              <EmptyState title={t("topupPkgEmptyFilter")} />
            </div>
          ) : (
            <TopupPackageAdminList
              packages={filtered}
              editingId={modalOpen ? editingId : null}
              busy={toggleMut.isPending || deleteMut.isPending}
              labels={{
                name: t("colName"),
                immediate: t("colImmediateCredits"),
                bonus: t("colBonusCredits"),
                total: t("colTotalCredits"),
                price: t("colPriceCny"),
                sort: t("colSort"),
                online: t("colOnline"),
                actions: t("actions"),
                edit: t("edit"),
                delete: t("delete"),
                onShelf: t("onShelf"),
                offShelf: t("offShelf"),
                unnamed: t("topupPkgUnnamed"),
              }}
              onEdit={openEdit}
              onToggleShelf={(pkg) => {
                setError(null);
                setPendingToggle(pkg);
              }}
              onDelete={(pkg) => {
                setError(null);
                setPendingDelete(pkg);
              }}
            />
          )}
        </div>
      </div>

      <GlassModal
        open={modalOpen}
        onClose={closeModal}
        size="md"
        className="!max-w-[38rem] !border-white/80 !bg-[#f4f6fb] !shadow-[0_32px_100px_rgba(15,23,42,0.28)] !backdrop-blur-none"
        title={
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-[0_8px_20px_rgba(245,158,11,0.3)]">
              <Coins className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-lg font-bold tracking-tight text-slate-900">
                {editingId ? t("topupPkgEdit") : t("topupPkgCreate")}
              </span>
              <span className="mt-0.5 block text-xs font-normal text-slate-500">
                {t("topupPkgSectionBasicHint")}
              </span>
            </span>
          </div>
        }
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!saveMut.isPending) saveMut.mutate();
          }}
        >
          <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.05)]">
            <div className="mb-5 flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">
                01
              </span>
              <div>
                <h3 className="text-sm font-bold text-slate-900">{t("topupPkgSectionBasic")}</h3>
                <p className="mt-0.5 text-xs text-slate-400">{t("topupPkgFieldsHint")}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-slate-700 sm:col-span-2" htmlFor="topup-pkg-name">
                {t("colName")}
                <span className="ml-1 font-normal text-slate-400">({t("optional")})</span>
                <Input
                  id="topup-pkg-name"
                  autoFocus
                  className="mt-1.5 h-10 rounded-xl border-slate-200 bg-slate-50/80 px-3.5 shadow-none backdrop-blur-none focus:bg-white"
                  value={form.name || ""}
                  onChange={(e) => patchForm({ name: e.target.value })}
                  maxLength={80}
                  placeholder={t("topupPkgNamePlaceholder")}
                />
              </label>

              <label className="block text-xs font-semibold text-slate-700" htmlFor="topup-pkg-base">
                <span className="flex items-center gap-1.5">
                  <Coins className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
                  {t("colImmediateCredits")}
                  <span className="text-danger" aria-hidden="true">
                    *
                  </span>
                </span>
                <Input
                  id="topup-pkg-base"
                  className="mt-2 h-11 rounded-xl border-slate-200 bg-slate-50/80 px-3.5 shadow-none backdrop-blur-none focus:bg-white"
                  type="number"
                  min={1}
                  required
                  value={form.baseCredits}
                  onChange={(e) => patchForm({ baseCredits: Number(e.target.value) })}
                />
              </label>

              <label className="block text-xs font-semibold text-slate-700" htmlFor="topup-pkg-bonus">
                <span className="flex items-center gap-1.5">
                  <Gift className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
                  {t("colBonusCredits")}
                  <span className="font-normal text-slate-400">({t("optional")})</span>
                </span>
                <Input
                  id="topup-pkg-bonus"
                  className="mt-2 h-11 rounded-xl border-slate-200 bg-slate-50/80 px-3.5 shadow-none backdrop-blur-none focus:bg-white"
                  type="number"
                  min={0}
                  value={form.bonusCredits ?? 0}
                  onChange={(e) => patchForm({ bonusCredits: Number(e.target.value) })}
                />
              </label>

              <div className="rounded-xl border border-amber-100 bg-amber-50/70 px-4 py-3 sm:col-span-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700/80">
                  {t("colTotalCredits")}
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-amber-900">{totalCredits}</p>
                <p className="mt-0.5 text-[11px] text-amber-700/70">{t("topupPkgTotalHint")}</p>
              </div>

              <label className="block text-xs font-semibold text-slate-700" htmlFor="topup-pkg-price">
                <span className="flex items-center gap-1.5">
                  <CircleDollarSign className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
                  {t("colPriceCny")}
                  <span className="text-danger" aria-hidden="true">
                    *
                  </span>
                </span>
                <Input
                  id="topup-pkg-price"
                  className="mt-2 h-11 rounded-xl border-slate-200 bg-slate-50/80 px-3.5 shadow-none backdrop-blur-none focus:bg-white"
                  type="number"
                  min={0.01}
                  step="0.01"
                  required
                  value={form.basePrice}
                  onChange={(e) => patchForm({ basePrice: Number(e.target.value) })}
                />
              </label>

              <label className="block text-xs font-semibold text-slate-700" htmlFor="topup-pkg-badge">
                <span className="flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
                  {t("colBadge")}
                  <span className="font-normal text-slate-400">({t("optional")})</span>
                </span>
                <Input
                  id="topup-pkg-badge"
                  className="mt-2 h-11 rounded-xl border-slate-200 bg-slate-50/80 px-3.5 shadow-none backdrop-blur-none focus:bg-white"
                  value={form.badge || ""}
                  onChange={(e) => patchForm({ badge: e.target.value }, { manualBadge: true })}
                  placeholder={t("topupPkgBadgePlaceholder")}
                  maxLength={20}
                />
                <p className="mt-1 text-[11px] text-slate-400">{t("topupPkgBadgeAutoHint")}</p>
              </label>

              <label className="block text-xs font-semibold text-slate-700 sm:col-span-2" htmlFor="topup-pkg-sort">
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    <GripVertical className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
                    {t("colSort")}
                  </span>
                  <span className="font-normal text-[10px] text-slate-400">{t("vipPlanSortHintShort")}</span>
                </span>
                <Input
                  id="topup-pkg-sort"
                  className="mt-2 h-11 rounded-xl border-slate-200 bg-slate-50/80 px-3.5 shadow-none backdrop-blur-none focus:bg-white"
                  type="number"
                  min={0}
                  max={999}
                  value={form.sortOrder ?? 0}
                  onChange={(e) => patchForm({ sortOrder: Number(e.target.value) })}
                />
              </label>
            </div>
          </section>

          {modalError ? (
            <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {modalError}
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-end">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-10 cursor-pointer px-5 text-slate-500 hover:-translate-y-0.5 hover:bg-slate-200/60 hover:text-slate-900 active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed"
              disabled={saveMut.isPending}
              onClick={closeModal}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-10 min-w-32 cursor-pointer rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-5 shadow-[0_8px_18px_rgba(245,158,11,0.28)] hover:-translate-y-0.5 hover:brightness-105 hover:shadow-[0_12px_24px_rgba(245,158,11,0.34)] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed"
              disabled={saveMut.isPending}
            >
              {saveMut.isPending ? t("saving") : editingId ? t("topupPkgSave") : t("topupPkgCreate")}
            </Button>
          </div>
        </form>
      </GlassModal>

      <ConfirmModal
        open={Boolean(pendingToggle)}
        onClose={() => setPendingToggle(null)}
        onConfirm={() => {
          if (pendingToggle) toggleMut.mutate(pendingToggle);
        }}
        message={
          pendingToggle?.active
            ? t("topupPkgConfirmOff", { name: pendingToggle.name?.trim() || pendingToggle.id })
            : t("topupPkgConfirmOn", {
                name: pendingToggle?.name?.trim() || pendingToggle?.id || "",
              })
        }
        confirmVariant={pendingToggle?.active ? "danger" : "primary"}
        busy={toggleMut.isPending}
      />

      <ConfirmModal
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) deleteMut.mutate(pendingDelete);
        }}
        message={t("topupPkgConfirmDelete", {
          name: pendingDelete?.name?.trim() || pendingDelete?.id || "",
        })}
        confirmVariant="danger"
        busy={deleteMut.isPending}
      />
    </>
  );
}

"use client";

import { useMemo, useState } from "react";
import { CalendarDays, CircleDollarSign, Crown, GripVertical, Plus, RefreshCw, Tag } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminCreateVipPlan, adminListVipPlans, adminUpdateVipPlan, asRows } from "@velvet/api-client";
import { vipPlanSchema, type VipPlanInput } from "@velvet/validators";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Select,
} from "@velvet/ui";
import { AdminShell } from "@/components/admin-shell";
import { ConfirmModal, GlassModal } from "@/components/glass-modal";
import { VipPlanAdminList, type VipPlanListModel } from "@/components/vip-plan-list";
import { useI18n } from "@/lib/i18n";

type Plan = VipPlanListModel;
type StatusFilter = "all" | "active" | "archived";
type VipPlanNameKey = "nameEn" | "nameZh" | "nameFr";

const vipPlanNameFields: Array<{ key: VipPlanNameKey; label: string; required?: boolean }> = [
  { key: "nameEn", label: "English", required: true },
  { key: "nameZh", label: "简体中文" },
  { key: "nameFr", label: "Français" },
];

const emptyForm: VipPlanInput = {
  nameEn: "",
  nameZh: "",
  nameFr: "",
  durationDays: 30,
  basePrice: 4.99,
  sortOrder: 0,
  badge: "",
  active: true,
};

export default function AdminVipPlansPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [form, setForm] = useState<VipPlanInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingToggle, setPendingToggle] = useState<Plan | null>(null);

  const listQ = useQuery({
    queryKey: ["admin", "vip-plans"],
    queryFn: async () => asRows<Plan>(await adminListVipPlans()),
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const parsed = vipPlanSchema.safeParse(form);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || t("validateFailed"));
      const payload = {
        ...parsed.data,
        nameZh: parsed.data.nameZh?.trim() || "",
        nameFr: parsed.data.nameFr?.trim() || "",
        badge: parsed.data.badge?.trim() || "",
      };
      return editingId ? adminUpdateVipPlan(editingId, payload) : adminCreateVipPlan(payload);
    },
    onSuccess: async () => {
      const wasEditing = Boolean(editingId);
      closeModal();
      setToast(wasEditing ? t("vipPlanUpdated") : t("vipPlanCreated"));
      await qc.invalidateQueries({ queryKey: ["admin", "vip-plans"] });
    },
    onError: (e: Error) => setModalError(e.message),
  });

  const toggleMut = useMutation({
    mutationFn: (plan: Plan) => adminUpdateVipPlan(plan.id, { active: !plan.active }),
    onSuccess: async (_data, plan) => {
      const planName = plan.nameEn || plan.name || plan.id;
      setToast(plan.active ? t("vipPlanOffShelved", { name: planName }) : t("vipPlanOnShelved", { name: planName }));
      setPendingToggle(null);
      if (editingId === plan.id) closeModal();
      await qc.invalidateQueries({ queryKey: ["admin", "vip-plans"] });
    },
    onError: (e: Error) => {
      setError(e.message);
      setPendingToggle(null);
    },
  });

  const rows = listQ.data ?? [];
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows
      .filter((plan) => {
        if (statusFilter === "active" && !plan.active) return false;
        if (statusFilter === "archived" && plan.active) return false;
        if (!needle) return true;
        return (
          String(plan.id).includes(needle) ||
          String(plan.name || "").toLowerCase().includes(needle) ||
          String(plan.nameEn || "").toLowerCase().includes(needle) ||
          String(plan.nameZh || "").toLowerCase().includes(needle) ||
          String(plan.nameFr || "").toLowerCase().includes(needle) ||
          String(plan.badge || "").toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => {
        const orderA = Number(a.sortOrder) || 0;
        const orderB = Number(b.sortOrder) || 0;
        if (orderA !== orderB) return orderA - orderB;
        return String(a.id).localeCompare(String(b.id));
      });
  }, [rows, search, statusFilter]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setModalError(null);
    setError(null);
    setModalOpen(true);
  }

  function openEdit(plan: Plan) {
    setEditingId(plan.id);
    setForm({
      nameEn: plan.nameEn || plan.name || "",
      nameZh: plan.nameZh || "",
      nameFr: plan.nameFr || "",
      durationDays: Number(plan.durationDays),
      basePrice: Number(plan.basePrice),
      sortOrder: Number(plan.sortOrder) || 0,
      badge: plan.badge || "",
      active: !!plan.active,
    });
    setModalError(null);
    setError(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setModalError(null);
    setEditingId(null);
    setForm(emptyForm);
  }

  function patchForm(patch: Partial<VipPlanInput>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  return (
    <AdminShell title={t("vipPlans")}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-body-sm text-ink-muted">{t("vipPriceHint")}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            className="cursor-pointer hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.97]"
            onClick={openCreate}
          >
            <Plus className="h-4 w-4" />
            {t("vipPlanCreate")}
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
          <h3 className="text-base font-semibold text-ink">{t("vipPlanList")}</h3>
          <Badge tone={rows.some((row) => row.active) ? "success" : "warning"}>
            {t("liveCount")}: {rows.filter((row) => row.active).length}
          </Badge>
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("vipPlanSearchPlaceholder")}
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
              <EmptyState title={t("vipPlanEmptyFilter")} />
            </div>
          ) : (
            <VipPlanAdminList
              plans={filtered}
              editingId={modalOpen ? editingId : null}
              busy={toggleMut.isPending}
              labels={{
                name: t("colName"),
                days: t("colDays"),
                price: t("colPriceCny"),
                sort: t("colSort"),
                status: t("status"),
                actions: t("actions"),
                edit: t("edit"),
                onShelf: t("onShelf"),
                offShelf: t("offShelf"),
                unnamed: t("vipPlanUnnamed"),
              }}
              onEdit={openEdit}
              onToggleShelf={(plan) => {
                setError(null);
                setPendingToggle(plan);
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
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6d5dfc] to-[#3b82f6] text-white shadow-[0_8px_20px_rgba(79,70,229,0.3)]">
              <Crown className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-lg font-bold tracking-tight text-slate-900">
                {editingId ? t("vipPlanEdit") : t("vipPlanCreate")}
              </span>
              <span className="mt-0.5 block text-xs font-normal text-slate-500">{t("vipPlanSectionBasicHint")}</span>
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
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">01</span>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{t("vipPlanSectionBasic")}</h3>
                  <p className="mt-0.5 text-xs text-slate-400">{editingId ? t("vipPlanEdit") : t("vipPlanCreate")}</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="flex flex-wrap items-end justify-between gap-1.5">
                    <h4 className="text-xs font-bold text-slate-800">{t("vipPlanNameLanguages")}</h4>
                    <p className="text-[10px] text-slate-400">{t("vipPlanNameFallbackHint")}</p>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {vipPlanNameFields.map((field) => (
                      <label
                        key={field.key}
                        className={field.required ? "block text-xs font-semibold text-slate-700 sm:col-span-2" : "block text-xs font-semibold text-slate-700"}
                        htmlFor={`vip-plan-${field.key}`}
                      >
                        <span className="flex items-center gap-1.5">
                          {field.label}
                          {field.required ? <span className="text-danger" aria-hidden="true">*</span> : null}
                        </span>
                        <Input
                          id={`vip-plan-${field.key}`}
                          autoFocus={field.key === "nameEn"}
                          required={field.required}
                          className="mt-1.5 h-10 rounded-xl border-slate-200 bg-slate-50/80 px-3.5 shadow-none backdrop-blur-none focus:bg-white"
                          value={form[field.key] || ""}
                          onChange={(e) => patchForm({ [field.key]: e.target.value })}
                          maxLength={80}
                        />
                      </label>
                    ))}
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-4">
                  <h4 className="mb-3 text-xs font-bold text-slate-800">{t("vipPlanSectionBasic")}</h4>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="block text-xs font-semibold text-slate-700" htmlFor="vip-plan-days">
                    <span className="flex items-center gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5 text-indigo-500" aria-hidden="true" />
                      {t("colDays")}
                    </span>
                    <Input
                      id="vip-plan-days"
                      className="mt-2 h-11 rounded-xl border-slate-200 bg-slate-50/80 px-3.5 shadow-none backdrop-blur-none focus:bg-white"
                      type="number"
                      min={1}
                      value={form.durationDays}
                      onChange={(e) => patchForm({ durationDays: Number(e.target.value) })}
                    />
                  </label>
                  <label className="block text-xs font-semibold text-slate-700" htmlFor="vip-plan-price">
                    <span className="flex items-center gap-1.5">
                      <CircleDollarSign className="h-3.5 w-3.5 text-indigo-500" aria-hidden="true" />
                      {t("colPriceCny")}
                    </span>
                    <Input
                      id="vip-plan-price"
                      className="mt-2 h-11 rounded-xl border-slate-200 bg-slate-50/80 px-3.5 shadow-none backdrop-blur-none focus:bg-white"
                      type="number"
                      min={0.01}
                      step="0.01"
                      value={form.basePrice}
                      onChange={(e) => patchForm({ basePrice: Number(e.target.value) })}
                    />
                  </label>
                  <label className="block text-xs font-semibold text-slate-700" htmlFor="vip-plan-badge">
                    <span className="flex items-center gap-1.5">
                      <Tag className="h-3.5 w-3.5 text-indigo-500" aria-hidden="true" />
                      {t("colBadge")}
                    </span>
                    <Input
                      id="vip-plan-badge"
                      className="mt-2 h-11 rounded-xl border-slate-200 bg-slate-50/80 px-3.5 shadow-none backdrop-blur-none focus:bg-white"
                      value={form.badge || ""}
                      onChange={(e) => patchForm({ badge: e.target.value })}
                      placeholder={t("vipPlanBadgePlaceholder")}
                      maxLength={40}
                    />
                  </label>
                  <label className="block text-xs font-semibold text-slate-700" htmlFor="vip-plan-sort">
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5">
                        <GripVertical className="h-3.5 w-3.5 text-indigo-500" aria-hidden="true" />
                        {t("colSort")}
                      </span>
                      <span className="font-normal text-[10px] text-slate-400">{t("vipPlanSortHintShort")}</span>
                    </span>
                    <Input
                      id="vip-plan-sort"
                      className="mt-2 h-11 rounded-xl border-slate-200 bg-slate-50/80 px-3.5 shadow-none backdrop-blur-none focus:bg-white"
                      type="number"
                      min={0}
                      max={999}
                      value={form.sortOrder ?? 0}
                      onChange={(e) => patchForm({ sortOrder: Number(e.target.value) })}
                    />
                  </label>
                  </div>
                </div>
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
              className="h-10 min-w-32 cursor-pointer rounded-xl bg-gradient-to-r from-[#5b5cf0] to-[#3b82f6] px-5 shadow-[0_8px_18px_rgba(79,70,229,0.28)] hover:-translate-y-0.5 hover:brightness-105 hover:shadow-[0_12px_24px_rgba(79,70,229,0.34)] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed"
              disabled={saveMut.isPending}
            >
              {saveMut.isPending ? t("saving") : editingId ? t("vipPlanSave") : t("vipPlanCreate")}
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
            ? t("vipPlanConfirmOff", { name: pendingToggle.nameEn?.trim() || pendingToggle.name?.trim() || pendingToggle.id })
            : t("vipPlanConfirmOn", { name: pendingToggle?.nameEn?.trim() || pendingToggle?.name?.trim() || pendingToggle?.id || "" })
        }
        confirmVariant={pendingToggle?.active ? "danger" : "primary"}
        busy={toggleMut.isPending}
      />
    </AdminShell>
  );
}

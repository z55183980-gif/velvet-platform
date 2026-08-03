"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import {
  adminCreateVipPlan,
  adminListVipPlans,
  adminUpdateVipPlan,
} from "@/lib/api";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { buttonVariants } from "@/components/ui/button";

export default function AdminVipPlansPage() {
  const { locale, t } = useLocale();
  const zh = locale === "zh";
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [durationDays, setDurationDays] = useState(30);
  const [basePrice, setBasePrice] = useState(28);
  const [sortOrder, setSortOrder] = useState(0);
  const [badge, setBadge] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    name: string;
    durationDays: number;
    basePrice: number;
    sortOrder: number;
    badge: string;
  } | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await adminListVipPlans();
      setRows(Array.isArray(r) ? r : r?.rows || []);
    } catch (e: any) {
      setErr(e?.message || "failed");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeCount = rows.filter((r) => r.active).length;

  return (
    <AdminLayout title={t("admin.vipPlans")}>
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="text-caption text-ink-muted">{zh ? "套餐数" : "Plans"}</p>
          <p className="mt-1 text-h3 font-semibold tabular-nums">{rows.length}</p>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="text-caption text-ink-muted">{zh ? "上架中" : "Active"}</p>
          <p className="mt-1 text-h3 font-semibold tabular-nums text-success">{activeCount}</p>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="text-caption text-ink-muted">{zh ? "定价币种" : "Base currency"}</p>
          <p className="mt-1 text-h3 font-semibold">CNY</p>
        </div>
      </div>

      <p className="text-body-sm text-ink-muted mb-4">
        {zh
          ? "VIP 套餐以人民币定价；用户选其它币种时按汇率折算。支付成功后按天数延长会员（可叠加）。"
          : "Gói VIP giá CNY; tiền tệ khác quy đổi theo tỷ giá. Sau thanh toán gia hạn theo ngày (cộng dồn)."}
      </p>
      {err ? <p className="text-danger text-body-sm mb-3">{err}</p> : null}
      {ok ? <p className="text-success text-body-sm mb-3">{ok}</p> : null}

      <div className="rounded-lg border border-line bg-surface p-4 mb-6">
        <p className="text-body-sm font-medium mb-3">{zh ? "新建套餐" : "Tạo gói mới"}</p>
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-caption text-ink-muted">
            {zh ? "名称" : "Tên"}
            <input
              className="block mt-1 rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-32"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={zh ? "月卡" : "Tháng"}
            />
          </label>
          <label className="text-caption text-ink-muted">
            {zh ? "天数" : "Ngày"}
            <input
              type="number"
              className="block mt-1 rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-24"
              value={durationDays}
              onChange={(e) => setDurationDays(Number(e.target.value))}
            />
          </label>
          <label className="text-caption text-ink-muted">
            {zh ? "人民币价" : "Giá CNY"}
            <input
              type="number"
              step="0.01"
              className="block mt-1 rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-28"
              value={basePrice}
              onChange={(e) => setBasePrice(Number(e.target.value))}
            />
          </label>
          <label className="text-caption text-ink-muted">
            Badge
            <input
              className="block mt-1 rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-24"
              value={badge}
              onChange={(e) => setBadge(e.target.value)}
              placeholder={zh ? "热门" : "Hot"}
            />
          </label>
          <label className="text-caption text-ink-muted">
            {zh ? "排序" : "Thứ tự"}
            <input
              type="number"
              className="block mt-1 rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-20"
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))}
            />
          </label>
          <button
            type="button"
            className={buttonVariants({ size: "sm" })}
            onClick={async () => {
              setOk(null);
              try {
                await adminCreateVipPlan({
                  name: name || undefined,
                  durationDays,
                  basePrice,
                  sortOrder,
                  badge: badge || undefined,
                });
                setName("");
                setBadge("");
                setOk(zh ? "已创建" : "Đã tạo");
                await load();
              } catch (e: any) {
                setErr(e?.message || "failed");
              }
            }}
          >
            {t("admin.create")}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-body-sm">
          <thead className="bg-surface-2 text-ink-muted text-left">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">{zh ? "名称" : "Tên"}</th>
              <th className="px-3 py-2">{zh ? "天数" : "Ngày"}</th>
              <th className="px-3 py-2">CNY</th>
              <th className="px-3 py-2">Badge</th>
              <th className="px-3 py-2">{zh ? "排序" : "Sort"}</th>
              <th className="px-3 py-2">{t("admin.status")}</th>
              <th className="px-3 py-2">{t("admin.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isEdit = editing === r.id;
              return (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="px-3 py-2 tabular-nums">{r.id}</td>
                  <td className="px-3 py-2">
                    {isEdit ? (
                      <input
                        className="rounded-md bg-surface-2 border border-line px-2 py-1 w-28"
                        value={editDraft?.name ?? ""}
                        onChange={(e) =>
                          setEditDraft((d) => (d ? { ...d, name: e.target.value } : d))
                        }
                      />
                    ) : (
                      r.name || "—"
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {isEdit ? (
                      <input
                        type="number"
                        className="rounded-md bg-surface-2 border border-line px-2 py-1 w-20"
                        value={editDraft?.durationDays ?? 0}
                        onChange={(e) =>
                          setEditDraft((d) =>
                            d ? { ...d, durationDays: Number(e.target.value) } : d,
                          )
                        }
                      />
                    ) : (
                      r.durationDays
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {isEdit ? (
                      <input
                        type="number"
                        step="0.01"
                        className="rounded-md bg-surface-2 border border-line px-2 py-1 w-24"
                        value={editDraft?.basePrice ?? 0}
                        onChange={(e) =>
                          setEditDraft((d) =>
                            d ? { ...d, basePrice: Number(e.target.value) } : d,
                          )
                        }
                      />
                    ) : (
                      r.basePrice
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {isEdit ? (
                      <input
                        className="rounded-md bg-surface-2 border border-line px-2 py-1 w-20"
                        value={editDraft?.badge ?? ""}
                        onChange={(e) =>
                          setEditDraft((d) => (d ? { ...d, badge: e.target.value } : d))
                        }
                      />
                    ) : (
                      r.badge || "—"
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {isEdit ? (
                      <input
                        type="number"
                        className="rounded-md bg-surface-2 border border-line px-2 py-1 w-16"
                        value={editDraft?.sortOrder ?? 0}
                        onChange={(e) =>
                          setEditDraft((d) =>
                            d ? { ...d, sortOrder: Number(e.target.value) } : d,
                          )
                        }
                      />
                    ) : (
                      r.sortOrder
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        r.active ? "text-success font-medium" : "text-ink-muted"
                      }
                    >
                      {r.active ? "ON" : "OFF"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {isEdit ? (
                        <>
                          <button
                            type="button"
                            className={buttonVariants({ size: "sm" })}
                            onClick={async () => {
                              if (!editDraft) return;
                              try {
                                await adminUpdateVipPlan(r.id, {
                                  name: editDraft.name,
                                  durationDays: editDraft.durationDays,
                                  basePrice: editDraft.basePrice,
                                  sortOrder: editDraft.sortOrder,
                                  badge: editDraft.badge,
                                });
                                setEditing(null);
                                setEditDraft(null);
                                setOk(zh ? "已保存" : "Đã lưu");
                                await load();
                              } catch (e: any) {
                                setErr(e?.message || "failed");
                              }
                            }}
                          >
                            {t("admin.save")}
                          </button>
                          <button
                            type="button"
                            className={buttonVariants({ variant: "ghost", size: "sm" })}
                            onClick={() => {
                              setEditing(null);
                              setEditDraft(null);
                            }}
                          >
                            {t("admin.cancel")}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className={buttonVariants({ variant: "secondary", size: "sm" })}
                          onClick={() => {
                            setEditing(r.id);
                            setEditDraft({
                              name: r.name || "",
                              durationDays: Number(r.durationDays),
                              basePrice: Number(r.basePrice),
                              sortOrder: Number(r.sortOrder) || 0,
                              badge: r.badge || "",
                            });
                          }}
                        >
                          {t("admin.edit")}
                        </button>
                      )}
                      <button
                        type="button"
                        className={buttonVariants({ variant: "secondary", size: "sm" })}
                        onClick={async () => {
                          try {
                            await adminUpdateVipPlan(r.id, { active: !r.active });
                            await load();
                          } catch (e: any) {
                            setErr(e?.message || "failed");
                          }
                        }}
                      >
                        {r.active ? (zh ? "下架" : "Tắt") : zh ? "上架" : "Bật"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!rows.length ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-ink-muted">
                  {t("admin.empty")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </AdminLayout>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n";
import { adminDashboard } from "@/lib/api";
import { AdminLayout, fmtNum } from "@/components/admin/AdminLayout";
import { buttonVariants } from "@/components/ui/button";
import { adminPath } from "@/lib/admin-path";

export default function AdminDashboardPage() {
  const { locale, t } = useLocale();
  const zh = locale === "zh";
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setData(await adminDashboard());
    } catch (e: any) {
      setErr(e?.message || "failed");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const today = data?.today;
  const week = data?.last7d;
  const todos = data?.todos;

  return (
    <AdminLayout title={t("admin.dashboard")}>
      {err ? <p className="text-danger text-body-sm mb-4">{err}</p> : null}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {[
          { label: zh ? "今日新用户" : "User hôm nay", value: today?.newUsers },
          { label: zh ? "今日 GMV ₫" : "GMV hôm nay", value: fmtNum(today?.gmvVnd) },
          { label: zh ? "今日解锁" : "Mở khóa hôm nay", value: today?.unlockCount },
          {
            label: zh ? "今日平台收入" : "Doanh thu nền tảng",
            value: fmtNum(today?.platformRevenueVnd),
          },
          { label: zh ? "7日新用户" : "User 7 ngày", value: week?.newUsers },
          { label: zh ? "7日 GMV ₫" : "GMV 7 ngày", value: fmtNum(week?.gmvVnd) },
          { label: zh ? "7日解锁" : "Mở khóa 7 ngày", value: week?.unlockCount },
          {
            label: zh ? "7日平台收入" : "Doanh thu 7 ngày",
            value: fmtNum(week?.platformRevenueVnd),
          },
        ].map((k) => (
          <div key={k.label} className="rounded-lg bg-surface border border-line p-4">
            <p className="text-caption text-ink-muted">{k.label}</p>
            <p className="text-h3 mt-1 tabular-nums">{k.value ?? "—"}</p>
          </div>
        ))}
      </div>

      <h2 className="text-h4 mb-3">{t("admin.todos")}</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          {
            href: `${adminPath("/content")}?status=PENDING_REVIEW`,
            label: t("admin.pendingDramas"),
            n: todos?.pendingDramas,
          },
          { href: `${adminPath("/kyc")}?status=PENDING`, label: t("admin.kyc"), n: todos?.pendingKyc },
          {
            href: `${adminPath("/withdraws")}?status=PENDING`,
            label: t("admin.pendingWithdraws"),
            n: todos?.pendingWithdraws,
            warn: todos?.overdueWithdraws,
          },
          {
            href: adminPath("/reconcile"),
            label: zh ? "对账差异" : "Lệch đối soát",
            n: todos?.reconcileMismatch,
          },
          {
            href: adminPath("/content"),
            label: zh ? "转码失败" : "Transcode lỗi",
            n: todos?.transcodeFailed,
          },
        ].map((x) => (
          <Link
            key={x.href + x.label}
            href={x.href}
            className="rounded-lg bg-surface border border-line p-4 hover:border-line-strong transition"
          >
            <p className="text-caption text-ink-muted">{x.label}</p>
            <p className={`text-h3 mt-1 tabular-nums ${x.n > 0 ? "text-warning" : ""}`}>
              {x.n ?? 0}
            </p>
            {x.warn > 0 ? (
              <p className="text-caption text-danger mt-1">
                {t("admin.overdue")}: {x.warn}
              </p>
            ) : null}
          </Link>
        ))}
      </div>

      <div className="mt-8 flex gap-2 flex-wrap">
        <button
          type="button"
          className={buttonVariants({ variant: "secondary", size: "sm" })}
          onClick={load}
        >
          {t("admin.refresh")}
        </button>
        <Link href={adminPath("/content")} className={buttonVariants({ size: "sm" })}>
          {t("admin.content")}
        </Link>
      </div>
    </AdminLayout>
  );
}

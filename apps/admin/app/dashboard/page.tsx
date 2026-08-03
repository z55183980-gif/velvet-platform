"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { adminDashboard } from "@velvet/api-client";
import { buttonVariants, fmtNum, StatCard } from "@velvet/ui";
import { AdminShell } from "@/components/admin-shell";
import { t } from "@/lib/i18n";

export default function AdminDashboardPage() {
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ["admin", "dashboard"],
    queryFn: () => adminDashboard(),
  });

  const today = (data as any)?.today;
  const week = (data as any)?.last7d;
  const todos = (data as any)?.todos;

  return (
    <AdminShell title={t("dashboard")}>
      {error ? (
        <p className="mb-4 text-body-sm text-danger">{(error as Error).message || "failed"}</p>
      ) : null}

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="今日新用户" value={today?.newUsers ?? "—"} />
        <StatCard label="今日 GMV ₫" value={fmtNum(today?.gmvVnd)} />
        <StatCard label="今日解锁" value={today?.unlockCount ?? "—"} />
        <StatCard label="今日平台收入" value={fmtNum(today?.platformRevenueVnd)} />
        <StatCard label="7日新用户" value={week?.newUsers ?? "—"} />
        <StatCard label="7日 GMV ₫" value={fmtNum(week?.gmvVnd)} />
        <StatCard label="7日解锁" value={week?.unlockCount ?? "—"} />
        <StatCard label="7日平台收入" value={fmtNum(week?.platformRevenueVnd)} />
      </div>

      <h2 className="mb-3 text-h4">{t("todos")}</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {[
          {
            href: "/content?status=PENDING_REVIEW",
            label: t("pendingDramas"),
            n: todos?.pendingDramas,
          },
          { href: "/kyc?status=PENDING", label: t("kyc"), n: todos?.pendingKyc },
          {
            href: "/withdraws?status=PENDING",
            label: t("pendingWithdraws"),
            n: todos?.pendingWithdraws,
            warn: todos?.overdueWithdraws,
          },
          { href: "/reconcile", label: "对账差异", n: todos?.reconcileMismatch },
          { href: "/content", label: "转码失败", n: todos?.transcodeFailed },
        ].map((x) => (
          <Link
            key={x.href + x.label}
            href={x.href}
            className="rounded-lg border border-line bg-surface p-4 transition hover:border-line-strong"
          >
            <p className="text-caption text-ink-muted">{x.label}</p>
            <p className={`mt-1 text-h3 tabular-nums ${x.n > 0 ? "text-warning" : ""}`}>
              {x.n ?? 0}
            </p>
            {x.warn > 0 ? (
              <p className="mt-1 text-caption text-danger">
                {t("overdue")}: {x.warn}
              </p>
            ) : null}
          </Link>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonVariants({ variant: "secondary", size: "sm" })}
          onClick={() => refetch()}
          disabled={isFetching}
        >
          {t("refresh")}
        </button>
        <Link href="/content" className={buttonVariants({ size: "sm" })}>
          {t("content")}
        </Link>
      </div>
    </AdminShell>
  );
}

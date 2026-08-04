"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  adminDashboard,
  type DashboardOverview,
  type DashboardRange,
} from "@velvet/api-client";
import { buttonVariants, DataTable, fmtNum, StatCard, type Column } from "@velvet/ui";
import { AdminShell } from "@/components/admin-shell";
import { useI18n, type LabelKey } from "@/lib/i18n";
import { useLocationSearchParams } from "@/lib/use-location-search";

const RANGE_KEYS: { id: DashboardRange; labelKey: LabelKey }[] = [
  { id: "today", labelKey: "rangeToday" },
  { id: "7d", labelKey: "range7d" },
  { id: "30d", labelKey: "range30d" },
];

type RankTab = "view" | "unlock" | "sales";

type DramaRankRow = {
  id: string;
  titleZh: string | null;
  titleVi: string | null;
  viewCount: number;
  unlockCount: number;
};

type SalesRankRow = {
  dramaId: string;
  titleZh: string | null;
  titleVi: string | null;
  orderCount: number;
  credits: string;
  amountVnd: string;
};

function parseRange(raw: string | null): DashboardRange {
  if (raw === "today" || raw === "7d" || raw === "30d") return raw;
  return "7d";
}

function setRangeInUrl(range: DashboardRange) {
  const url = new URL(window.location.href);
  url.searchParams.set("range", range);
  history.replaceState(null, "", `${url.pathname}${url.search}`);
}

function formatDelta(pct: number | null | undefined) {
  if (pct == null) return { text: "—", tone: "muted" as const };
  if (pct === 0) return { text: "0%", tone: "muted" as const };
  const sign = pct > 0 ? "+" : "";
  return {
    text: `${sign}${pct}%`,
    tone: pct > 0 ? ("up" as const) : ("down" as const),
  };
}

function KpiCard({
  label,
  value,
  delta,
  vsLabel,
}: {
  label: string;
  value: string | number;
  delta: number | null | undefined;
  vsLabel: string;
}) {
  const d = formatDelta(delta);
  return (
    <div className="card glass-card p-4 md:p-5">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-ink">{value}</p>
      <p
        className={`mt-1 text-xs font-medium tabular-nums ${
          d.tone === "up" ? "text-success" : d.tone === "down" ? "text-danger" : "text-ink-subtle"
        }`}
      >
        {vsLabel} {d.text}
      </p>
    </div>
  );
}

function TrendChart({
  trends,
  t,
}: {
  trends: DashboardOverview["trends"];
  t: ReturnType<typeof useI18n>["t"];
}) {
  const series = useMemo(() => {
    const gmv = trends.map((x) => Number(x.gmvVnd || 0));
    const users = trends.map((x) => x.newUsers);
    const unlocks = trends.map((x) => x.unlockCount);
    return { gmv, users, unlocks, labels: trends.map((x) => x.date.slice(5)) };
  }, [trends]);

  const w = 640;
  const h = 220;
  const pad = { t: 16, r: 12, b: 28, l: 12 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;

  const lines = useMemo(() => {
    const build = (values: number[], color: string) => {
      const max = Math.max(...values, 1);
      const n = Math.max(values.length, 1);
      const pts = values.map((v, i) => {
        const x = pad.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
        const y = pad.t + innerH - (v / max) * innerH;
        return `${x},${y}`;
      });
      return { color, points: pts.join(" "), max };
    };
    return [
      { key: "gmv", label: "GMV", ...build(series.gmv, "#007aff") },
      { key: "users", label: t("kpiNewUsers"), ...build(series.users, "#047857") },
      { key: "unlocks", label: t("unlocks"), ...build(series.unlocks, "#b45309") },
    ];
  }, [series, innerH, innerW, pad.l, pad.t, t]);

  if (!trends.length) {
    return (
      <div className="card glass-card flex h-[240px] items-center justify-center text-sm text-ink-muted">
        {t("empty")}
      </div>
    );
  }

  return (
    <div className="card glass-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-ink">{t("trend")}</h2>
        <div className="flex flex-wrap gap-3 text-xs text-ink-muted">
          {lines.map((l) => (
            <span key={l.key} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label={t("trend")}>
        {[0.25, 0.5, 0.75, 1].map((p) => {
          const y = pad.t + innerH * (1 - p);
          return (
            <line
              key={p}
              x1={pad.l}
              x2={w - pad.r}
              y1={y}
              y2={y}
              stroke="rgba(15,20,25,0.08)"
              strokeWidth="1"
            />
          );
        })}
        {lines.map((l) => (
          <polyline
            key={l.key}
            fill="none"
            stroke={l.color}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={l.points}
          />
        ))}
        {series.labels.map((label, i) => {
          const n = series.labels.length;
          if (n > 14 && i % Math.ceil(n / 8) !== 0 && i !== n - 1) return null;
          const x = pad.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
          return (
            <text
              key={`${label}-${i}`}
              x={x}
              y={h - 8}
              textAnchor="middle"
              className="fill-ink-subtle"
              style={{ fontSize: 10 }}
            >
              {label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export default function AdminDashboardPage() {
  const { t } = useI18n();
  const search = useLocationSearchParams();
  const range = parseRange(search.get("range"));
  const [rankTab, setRankTab] = useState<RankTab>("view");

  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ["admin", "dashboard", range],
    queryFn: () => adminDashboard(range),
  });

  const todos = data?.todos;
  const todoItems = useMemo(() => {
    const items = [
      {
        href: "/content?status=PENDING_REVIEW",
        label: t("pendingDramas"),
        n: todos?.pendingDramas ?? 0,
        priority: 0,
      },
      {
        href: "/creators?tab=kyc",
        label: t("kyc"),
        n: todos?.pendingKyc ?? 0,
        priority: 0,
      },
      {
        href: "/withdraws?status=PENDING",
        label: t("pendingWithdraws"),
        n: todos?.pendingWithdraws ?? 0,
        warn: todos?.overdueWithdraws ?? 0,
        priority: (todos?.overdueWithdraws ?? 0) > 0 ? 2 : 0,
      },
      {
        href: "/reconcile",
        label: t("reconcileMismatch"),
        n: todos?.reconcileMismatch ?? 0,
        priority: 0,
      },
      {
        href: "/content",
        label: t("transcodeFailed"),
        n: todos?.transcodeFailed ?? 0,
        priority: 0,
      },
    ];
    return items
      .map((x) => ({ ...x, priority: x.priority + (x.n > 0 ? 1 : 0) }))
      .sort((a, b) => b.priority - a.priority || b.n - a.n);
  }, [todos]);

  const viewColumns: Column<DramaRankRow>[] = useMemo(
    () => [
      {
        key: "title",
        header: t("drama"),
        cell: (row) => (
          <Link href={`/content/${row.id}`} className="text-brand hover:underline">
            {row.titleZh || row.titleVi || "—"}
          </Link>
        ),
      },
      { key: "views", header: t("views"), cell: (row) => fmtNum(row.viewCount), className: "tabular-nums" },
      {
        key: "unlocks",
        header: t("unlocks"),
        cell: (row) => fmtNum(row.unlockCount),
        className: "tabular-nums",
      },
    ],
    [t],
  );

  const salesColumns: Column<SalesRankRow>[] = useMemo(
    () => [
      {
        key: "drama",
        header: t("drama"),
        cell: (r) => (
          <Link href={`/content/${r.dramaId}`} className="text-brand hover:underline">
            {r.titleZh || r.titleVi || "—"}
          </Link>
        ),
      },
      { key: "orders", header: t("orderCount"), cell: (r) => String(r.orderCount ?? 0) },
      { key: "credits", header: t("colCredits"), cell: (r) => fmtNum(r.credits), className: "tabular-nums" },
      { key: "vnd", header: "VND", cell: (r) => fmtNum(r.amountVnd), className: "tabular-nums" },
    ],
    [t],
  );

  const period = data?.period;
  const deltas = data?.deltas;
  const biz = data?.bizBreakdown;

  return (
    <AdminShell title={t("dashboard")}>
      {error ? (
        <p className="mb-4 rounded-xl border border-rose-300/40 bg-rose-50/80 px-3 py-2 text-sm text-rose-700">
          {(error as Error).message || "failed"}
        </p>
      ) : null}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-line bg-surface p-1">
          {RANGE_KEYS.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                range === r.id ? "bg-brand text-white" : "text-ink-muted hover:text-ink"
              }`}
              onClick={() => setRangeInUrl(r.id)}
            >
              {t(r.labelKey)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={buttonVariants({ variant: "secondary", size: "sm" })}
          onClick={() => refetch()}
          disabled={isFetching}
        >
          {t("refresh")}
        </button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiCard label={t("kpiNewUsers")} value={period?.newUsers ?? "—"} delta={deltas?.newUsersPct} vsLabel={t("vsLastPeriod")} />
        <KpiCard label={t("kpiGmv")} value={fmtNum(period?.gmvVnd)} delta={deltas?.gmvPct} vsLabel={t("vsLastPeriod")} />
        <KpiCard label={t("kpiUnlocks")} value={period?.unlockCount ?? "—"} delta={deltas?.unlockPct} vsLabel={t("vsLastPeriod")} />
        <KpiCard
          label={t("kpiRevenue")}
          value={fmtNum(period?.platformRevenueVnd)}
          delta={deltas?.revenuePct}
          vsLabel={t("vsLastPeriod")}
        />
        <KpiCard label={t("kpiOrders")} value={period?.paidOrders ?? "—"} delta={deltas?.ordersPct} vsLabel={t("vsLastPeriod")} />
      </div>

      <div className="mb-6">
        <TrendChart trends={data?.trends ?? []} t={t} />
      </div>

      <h2 className="mb-3 text-base font-semibold text-ink">{t("todos")}</h2>
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {todoItems.map((x) => (
          <Link
            key={x.href + x.label}
            href={x.href}
            className="card glass-card p-4 transition hover:shadow-[0_8px_32px_rgba(15,20,25,0.08)]"
          >
            <p className="text-xs font-medium text-ink-muted">{x.label}</p>
            <p
              className={`mt-2 text-2xl font-semibold tabular-nums ${
                x.n > 0 ? "text-amber-700" : "text-ink"
              }`}
            >
              {x.n}
            </p>
            {"warn" in x && (x.warn as number) > 0 ? (
              <p className="mt-1 text-xs font-medium text-rose-700">
                {t("overdue")}: {x.warn as number}
              </p>
            ) : null}
          </Link>
        ))}
      </div>

      <h2 className="mb-3 text-base font-semibold text-ink">{t("bizBreakdown")}</h2>
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label={t("activeVip")} value={biz?.activeVipUsers ?? "—"} />
        <StatCard
          label={t("topupStat")}
          value={`${biz?.topup?.count ?? 0} / ${fmtNum(biz?.topup?.credits)}`}
        />
        <StatCard
          label={t("vipStat")}
          value={`${biz?.vip?.count ?? 0} / ${fmtNum(biz?.vip?.amountVnd)}`}
        />
        <StatCard
          label={t("unlockStat")}
          value={`${biz?.unlock?.count ?? 0} / ${fmtNum(biz?.unlock?.credits)}`}
        />
        <StatCard
          label={t("buyoutStat")}
          value={`${biz?.dramaBuyout?.count ?? 0} / ${fmtNum(biz?.dramaBuyout?.credits)}`}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">{t("rankings")}</h2>
        <div className="inline-flex rounded-xl border border-line bg-surface p-1">
          {(
            [
              { id: "view" as const, label: t("rankByView") },
              { id: "unlock" as const, label: t("rankByUnlock") },
              { id: "sales" as const, label: t("rankBySales") },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                rankTab === tab.id ? "bg-brand text-white" : "text-ink-muted hover:text-ink"
              }`}
              onClick={() => setRankTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {rankTab === "sales" ? (
        <DataTable
          columns={salesColumns}
          rows={(data?.rankings.topBySales ?? []) as SalesRankRow[]}
          loading={isFetching && !data}
          emptyTitle={t("empty")}
          getRowKey={(r) => String(r.dramaId)}
        />
      ) : (
        <DataTable
          columns={viewColumns}
          rows={
            ((rankTab === "view" ? data?.rankings.topByView : data?.rankings.topByUnlock) ??
              []) as DramaRankRow[]
          }
          loading={isFetching && !data}
          emptyTitle={t("empty")}
          getRowKey={(r) => String(r.id)}
        />
      )}
    </AdminShell>
  );
}

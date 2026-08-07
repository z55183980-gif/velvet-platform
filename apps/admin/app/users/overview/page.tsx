"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  adminUserStatistics,
  type UserStatisticsOverview,
  type UserStatsRange,
} from "@velvet/api-client";
import { buttonVariants, fmtNum } from "@velvet/ui";
import { AdminShell } from "@/components/admin-shell";
import { useI18n, type LabelKey } from "@/lib/i18n";
import { useLocationSearchParams } from "@/lib/use-location-search";

type RangePreset = UserStatsRange;

const PRESET_KEYS: { id: RangePreset; labelKey: LabelKey }[] = [
  { id: "today", labelKey: "rangeToday" },
  { id: "7d", labelKey: "range7d" },
  { id: "30d", labelKey: "range30d" },
  { id: "custom", labelKey: "rangeCustom" },
];

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysAgoKey(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parsePreset(raw: string | null): RangePreset {
  if (raw === "today" || raw === "7d" || raw === "30d" || raw === "custom") return raw;
  return "7d";
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

function pctDelta(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

function localeLabel(t: ReturnType<typeof useI18n>["t"], locale: string) {
  if (locale === "zh") return t("localeZh");
  if (locale === "fr") return "Français";
  return "English";
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-wide text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function KpiCard({
  label,
  value,
  description,
  delta,
  vsLabel,
}: {
  label: string;
  value: string | number;
  description: string;
  delta?: number | null;
  vsLabel?: string;
}) {
  const d = delta != null ? formatDelta(delta) : null;
  return (
    <div className="card glass-card p-4 md:p-5">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-ink">{value}</p>
      {d && vsLabel ? (
        <p
          className={`mt-1 text-xs font-medium tabular-nums ${
            d.tone === "up" ? "text-success" : d.tone === "down" ? "text-danger" : "text-ink-subtle"
          }`}
        >
          {vsLabel} {d.text}
        </p>
      ) : (
        <p className="mt-1 text-xs text-ink-subtle">{description}</p>
      )}
    </div>
  );
}

function RegistrationTrendChart({
  trends,
  title,
  emptyLabel,
}: {
  trends: UserStatisticsOverview["registrationTrend"];
  title: string;
  emptyLabel: string;
}) {
  const series = useMemo(
    () => ({
      values: trends.map((x) => x.count),
      labels: trends.map((x) => x.date.slice(5)),
    }),
    [trends],
  );

  const w = 640;
  const h = 220;
  const pad = { t: 16, r: 12, b: 28, l: 28 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const max = Math.max(...series.values, 1);
  const n = Math.max(series.values.length, 1);
  const barW = Math.min(28, (innerW / n) * 0.65);

  if (!trends.length) {
    return (
      <div className="card glass-card flex h-[240px] items-center justify-center text-sm text-ink-muted">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="card glass-card h-full p-4">
      <h3 className="mb-3 text-base font-semibold text-ink">{title}</h3>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label={title}>
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
        {series.values.map((v, i) => {
          const slotW = innerW / n;
          const x = pad.l + slotW * i + (slotW - barW) / 2;
          const barH = (v / max) * innerH;
          const y = pad.t + innerH - barH;
          return (
            <rect
              key={series.labels[i] ?? i}
              x={x}
              y={y}
              width={barW}
              height={Math.max(barH, v > 0 ? 2 : 0)}
              rx={3}
              fill="#047857"
            />
          );
        })}
        {series.labels.map((label, i) => {
          if (n > 14 && i % Math.ceil(n / 8) !== 0 && i !== n - 1) return null;
          const slotW = innerW / n;
          const x = pad.l + slotW * i + slotW / 2;
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

function LocaleDistribution({
  items,
  total,
  title,
  subtitle,
  t,
}: {
  items: UserStatisticsOverview["localeDistribution"];
  total: number;
  title: string;
  subtitle: string;
  t: ReturnType<typeof useI18n>["t"];
}) {
  return (
    <div className="card glass-card h-full p-4 md:p-5">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>
      </div>
      {!items.length ? (
        <p className="text-sm text-ink-muted">{t("empty")}</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const pct = total ? (item.count / total) * 100 : 0;
            return (
              <div key={item.locale} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium text-ink">{localeLabel(t, item.locale)}</span>
                  <span className="tabular-nums text-ink-muted">
                    {fmtNum(item.count)} · {pct.toFixed(1)}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-brand transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function setRangeInUrl(preset: RangePreset, startDate?: string, endDate?: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("range", preset);
  if (preset === "custom" && startDate && endDate) {
    url.searchParams.set("startDate", startDate);
    url.searchParams.set("endDate", endDate);
  } else {
    url.searchParams.delete("startDate");
    url.searchParams.delete("endDate");
  }
  history.replaceState(null, "", `${url.pathname}${url.search}`);
}

export default function UserOverviewPage() {
  const { t } = useI18n();
  const search = useLocationSearchParams();
  const preset = parsePreset(search.get("range"));
  const urlStart = search.get("startDate") ?? daysAgoKey(29);
  const urlEnd = search.get("endDate") ?? todayKey();
  const [draftStart, setDraftStart] = useState(urlStart);
  const [draftEnd, setDraftEnd] = useState(urlEnd);

  const queryParams = useMemo(() => {
    if (preset === "custom") {
      return { range: "custom" as const, startDate: urlStart, endDate: urlEnd };
    }
    return { range: preset };
  }, [preset, urlStart, urlEnd]);

  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ["admin", "users", "statistics", queryParams],
    queryFn: () => adminUserStatistics(queryParams),
  });

  const summary = data?.summary;
  const paidUserShare = summary?.totalUsers
    ? Math.round((summary.paidUsers / summary.totalUsers) * 1000) / 10
    : 0;
  const loginRate = summary?.totalUsers
    ? Math.round((summary.activeUsers / summary.totalUsers) * 1000) / 10
    : 0;
  const newUserDelta = summary
    ? pctDelta(summary.newUsers, summary.newPreviousPeriod)
    : null;
  const periodLabel = data?.period ? `${data.period.start} – ${data.period.end}` : null;

  return (
    <AdminShell title={t("userOverview")}>
      {error ? (
        <p className="mb-4 rounded-xl border border-danger/20 bg-danger-soft px-3 py-2 text-body-sm text-danger">
          {(error as Error).message || "failed"}
        </p>
      ) : null}

      <div className="mb-6 flex flex-col gap-3 rounded-xl border border-line bg-white/40 p-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium text-ink">{t("filter")}</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {periodLabel ? periodLabel : t("userStatsRangeHint")}
            {periodLabel ? (
              <span className="text-ink-subtle"> · {t("userStatsRangeHint")}</span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-line bg-surface p-1">
            {PRESET_KEYS.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  preset === r.id ? "bg-brand text-white" : "text-ink-muted hover:text-ink"
                }`}
                onClick={() => {
                  if (r.id === "custom") {
                    setDraftStart(urlStart);
                    setDraftEnd(urlEnd);
                    setRangeInUrl("custom", urlStart, urlEnd);
                  } else {
                    setRangeInUrl(r.id);
                  }
                }}
              >
                {t(r.labelKey)}
              </button>
            ))}
          </div>
          {preset === "custom" ? (
            <>
              <input
                type="date"
                className="rounded-lg border border-line bg-white/80 px-2 py-1.5 text-sm text-ink"
                value={draftStart}
                max={draftEnd}
                onChange={(e) => setDraftStart(e.target.value)}
              />
              <span className="text-ink-muted">–</span>
              <input
                type="date"
                className="rounded-lg border border-line bg-white/80 px-2 py-1.5 text-sm text-ink"
                value={draftEnd}
                min={draftStart}
                max={todayKey()}
                onChange={(e) => setDraftEnd(e.target.value)}
              />
              <button
                type="button"
                className={buttonVariants({ variant: "secondary", size: "sm" })}
                onClick={() => setRangeInUrl("custom", draftStart, draftEnd)}
              >
                {t("rangeApply")}
              </button>
            </>
          ) : null}
          <button
            type="button"
            className={buttonVariants({ variant: "secondary", size: "sm" })}
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {t("refresh")}
          </button>
        </div>
      </div>

      <Section title={t("userStatsSectionUsers")}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label={t("userStatsTotal")}
            value={summary?.totalUsers ?? "—"}
            description={t("userStatsTotalDesc")}
          />
          <KpiCard
            label={t("userStatsLoggedIn")}
            value={summary?.activeUsers ?? "—"}
            description={`${loginRate}% · ${t("userStatsLoggedInDesc")}`}
          />
          <KpiCard
            label={t("userStatsNew")}
            value={summary?.newUsers ?? "—"}
            description={t("userStatsNewDesc")}
            delta={newUserDelta}
            vsLabel={t("comparedPrevPeriod")}
          />
          <KpiCard
            label={t("userStatsPaidUsers")}
            value={summary?.paidUsers ?? "—"}
            description={`${paidUserShare}% · ${t("userStatsPaidUsersDesc")}`}
          />
        </div>
      </Section>

      <Section title={t("userStatsSectionFinance")}>
        <div className="grid gap-3 sm:grid-cols-3">
          <KpiCard
            label={t("userStatsTotalPaid")}
            value={summary ? fmtNum(summary.totalPaidAmountVnd) : "—"}
            description={t("userStatsTotalPaidDesc")}
          />
          <KpiCard
            label={t("userStatsTotalUsage")}
            value={summary ? fmtNum(summary.totalSpentCredits) : "—"}
            description={t("userStatsUsageDesc")}
          />
          <KpiCard
            label={t("userStatsActiveVip")}
            value={summary ? fmtNum(summary.activeVipUsers) : "—"}
            description={t("userStatsVipDesc")}
          />
        </div>
        <div className="mt-3 card glass-card p-4 md:p-5">
          <p className="text-xs font-medium text-ink-muted">{t("creditBalance")}</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-white/50 px-4 py-3">
              <p className="text-3xl font-semibold tabular-nums tracking-tight text-ink">
                {summary ? fmtNum(summary.totalCreditsBalance) : "—"}
              </p>
              <p className="mt-1 text-xs text-ink-subtle">{t("creditsBalanceTotal")}</p>
            </div>
            <div className="rounded-xl bg-white/50 px-4 py-3">
              <p className="text-3xl font-semibold tabular-nums tracking-tight text-ink">
                {summary ? fmtNum(summary.totalPaidTopupCredits) : "—"}
              </p>
              <p className="mt-1 text-xs text-ink-subtle">{t("creditsBalanceFromTopup")}</p>
            </div>
          </div>
        </div>
      </Section>

      <Section title={t("userStatsSectionCharts")}>
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <RegistrationTrendChart
            trends={data?.registrationTrend ?? []}
            title={t("userStatsRegTrend")}
            emptyLabel={t("empty")}
          />
          <LocaleDistribution
            items={data?.localeDistribution ?? []}
            total={summary?.totalUsers ?? 0}
            title={t("userStatsLocaleDist")}
            subtitle={t("userStatsLocaleDistDesc")}
            t={t}
          />
        </div>
      </Section>
    </AdminShell>
  );
}

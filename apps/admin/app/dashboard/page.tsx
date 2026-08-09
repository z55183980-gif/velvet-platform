"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  adminDashboard,
  type DashboardOverview,
  type DashboardRange,
} from "@velvet/api-client";
import { buttonVariants, DataTable, fmtNum, Skeleton, StatCard, type Column } from "@velvet/ui";
import { AdminShell } from "@/components/admin-shell";
import { useI18n, type LabelKey } from "@/lib/i18n";
import { useLocationSearchParams } from "@/lib/use-location-search";

const RANGE_KEYS: { id: Exclude<DashboardRange, "custom">; labelKey: LabelKey }[] = [
  { id: "today", labelKey: "rangeToday" },
  { id: "7d", labelKey: "range7d" },
  { id: "30d", labelKey: "range30d" },
];

const CUSTOM_MAX_DAYS = 90;

type RankTab = "view" | "unlock" | "sales";
type SeriesKey = "gmv" | "users" | "unlocks";

type DramaRankRow = {
  id: string;
  titleZh: string | null;
  titleEn: string | null;
  viewCount: number;
  unlockCount: number;
};

type SalesRankRow = {
  dramaId: string;
  titleZh: string | null;
  titleEn: string | null;
  orderCount: number;
  credits: string;
  amountVnd: string;
};

function dayKeyLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysLocal(d: Date, n: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + n);
  return out;
}

function parseDayLocal(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(y, mo - 1, day);
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== day) return null;
  return d;
}

function defaultCustomRange(): { from: string; to: string } {
  const to = new Date();
  const from = addDaysLocal(to, -6);
  return { from: dayKeyLocal(from), to: dayKeyLocal(to) };
}

function inclusiveDaySpan(from: string, to: string): number | null {
  const a = parseDayLocal(from);
  const b = parseDayLocal(to);
  if (!a || !b || a.getTime() > b.getTime()) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
}

function parseRank(raw: string | null): RankTab {
  if (raw === "view" || raw === "unlock" || raw === "sales") return raw;
  return "view";
}

function patchDashboardUrl(patch: {
  range?: DashboardRange;
  rank?: RankTab;
  from?: string | null;
  to?: string | null;
}) {
  const url = new URL(window.location.href);
  if (patch.range) url.searchParams.set("range", patch.range);
  if (patch.rank) url.searchParams.set("rank", patch.rank);
  if (patch.range === "custom") {
    if (patch.from) url.searchParams.set("from", patch.from);
    if (patch.to) url.searchParams.set("to", patch.to);
  } else if (patch.range) {
    url.searchParams.delete("from");
    url.searchParams.delete("to");
  } else {
    if (patch.from === null) url.searchParams.delete("from");
    else if (patch.from) url.searchParams.set("from", patch.from);
    if (patch.to === null) url.searchParams.delete("to");
    else if (patch.to) url.searchParams.set("to", patch.to);
  }
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

function niceMax(raw: number): number {
  if (raw <= 0) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  const n = raw / base;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * base;
}

function fmtAxisTick(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${trimFixed(n / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${trimFixed(n / 1_000_000)}M`;
  if (abs >= 1_000) return `${trimFixed(n / 1_000)}k`;
  return String(Math.round(n));
}

function trimFixed(n: number): string {
  const s = n >= 10 ? n.toFixed(0) : n.toFixed(1);
  return s.replace(/\.0$/, "");
}

function formatAsOf(ms: number, locale: string) {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

/** Lightweight accessible tip bubble — hover/focus/click; Escape closes. */
function TipHint({ text, label }: { text: string; label: string }) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("touchstart", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("touchstart", onPointer);
    };
  }, [open]);

  return (
    <span
      ref={rootRef}
      className="relative inline-flex shrink-0"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-line bg-panel text-[10px] font-semibold leading-none text-ink-muted transition hover:border-brand/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        ?
      </button>
      {open ? (
        <span
          id={tipId}
          role="tooltip"
          className="absolute left-1/2 top-full z-30 w-max max-w-[220px] -translate-x-1/2 pt-1.5"
        >
          <span className="block rounded-lg border border-line bg-surface px-2.5 py-2 text-left text-[11px] leading-snug text-ink-muted shadow-sm">
            {text}
          </span>
        </span>
      ) : null}
    </span>
  );
}

function KpiCard({
  label,
  value,
  delta,
  vsLabel,
  tip,
  tipLabel,
  prevZeroHint,
}: {
  label: string;
  value: string | number;
  delta: number | null | undefined;
  vsLabel: string;
  tip?: string;
  tipLabel: string;
  prevZeroHint: string;
}) {
  const d = formatDelta(delta);
  return (
    <div className="card glass-card p-4 md:p-5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
        <span>{label}</span>
        {tip ? <TipHint text={tip} label={tipLabel} /> : null}
      </p>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-ink">{value}</p>
      {d.text === "—" ? (
        <p className="mt-1 text-xs font-medium text-ink-subtle">{prevZeroHint}</p>
      ) : (
        <p
          className={`mt-1 text-xs font-medium tabular-nums ${
            d.tone === "up" ? "text-success" : d.tone === "down" ? "text-danger" : "text-ink-subtle"
          }`}
        >
          {vsLabel} {d.text}
        </p>
      )}
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="card glass-card p-4 md:p-5">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="mt-3 h-7 w-24" />
      <Skeleton className="mt-2 h-3 w-20" />
    </div>
  );
}

function TippedStat({
  label,
  value,
  tip,
  tipLabel,
}: {
  label: string;
  value: ReactNode;
  tip: string;
  tipLabel: string;
}) {
  return (
    <div className="relative">
      <div className="absolute right-3 top-3 z-10">
        <TipHint text={tip} label={tipLabel} />
      </div>
      <StatCard label={label} value={value} />
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
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [enabled, setEnabled] = useState<Record<SeriesKey, boolean>>({
    gmv: true,
    users: true,
    unlocks: true,
  });

  const series = useMemo(() => {
    const gmv = trends.map((x) => Number(x.gmvVnd || 0));
    const users = trends.map((x) => x.newUsers);
    const unlocks = trends.map((x) => x.unlockCount);
    return {
      gmv,
      users,
      unlocks,
      labels: trends.map((x) => x.date.slice(5)),
      dates: trends.map((x) => x.date),
    };
  }, [trends]);

  const defs = useMemo(
    () =>
      [
        {
          key: "gmv" as const,
          label: "GMV",
          color: "#007aff",
          values: series.gmv,
          axis: "money" as const,
          commercial: true,
        },
        {
          key: "users" as const,
          label: t("kpiNewUsers"),
          color: "#047857",
          values: series.users,
          axis: "count" as const,
          commercial: false,
        },
        {
          key: "unlocks" as const,
          label: t("unlocks"),
          color: "#b45309",
          values: series.unlocks,
          axis: "count" as const,
          commercial: true,
        },
      ].map((d) => ({ ...d, max: Math.max(...d.values, 0) })),
    [series, t],
  );

  const available = useMemo(() => defs.filter((d) => d.max > 0), [defs]);
  const allZero = available.length === 0;
  const commercialCold =
    !allZero && defs.filter((d) => d.commercial).every((d) => d.max === 0);

  const active = useMemo(() => {
    const on = available.filter((d) => enabled[d.key]);
    return on.length ? on : available.slice(0, 1);
  }, [available, enabled]);

  const showCountAxis = active.some((d) => d.axis === "count");
  const showMoneyAxis = active.some((d) => d.axis === "money");

  const countMax = niceMax(Math.max(0, ...active.filter((d) => d.axis === "count").map((d) => d.max)));
  const moneyMax = niceMax(Math.max(0, ...active.filter((d) => d.axis === "money").map((d) => d.max)));

  const w = 640;
  const h = 220;
  const padT = 16;
  // When only money axis: put ticks on the left for readability
  const moneyOnLeft = showMoneyAxis && !showCountAxis;
  const moneyOnRight = showMoneyAxis && showCountAxis;
  const padL = moneyOnLeft || showCountAxis ? 40 : 12;
  const padR = moneyOnRight ? 48 : 12;
  const innerW = w - padL - padR;
  const innerH = h - padT - 28;

  const lines = useMemo(() => {
    const n = Math.max(series.labels.length, 1);
    return active.map((d) => {
      const max = d.axis === "money" ? moneyMax : countMax;
      const pts = d.values.map((v, i) => {
        const x = padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
        const y = padT + innerH - (v / max) * innerH;
        return { x, y, v };
      });
      return {
        ...d,
        points: pts.map((p) => `${p.x},${p.y}`).join(" "),
        pts,
      };
    });
  }, [active, series.labels.length, innerH, innerW, padL, countMax, moneyMax]);

  const leftTicks = useMemo(() => {
    const max = moneyOnLeft ? moneyMax : countMax;
    if (!showCountAxis && !moneyOnLeft) return [];
    return [0, 0.5, 1].map((p) => ({
      p,
      y: padT + innerH * (1 - p),
      label: fmtAxisTick(max * p),
    }));
  }, [showCountAxis, moneyOnLeft, countMax, moneyMax, innerH]);

  const rightTicks = useMemo(() => {
    if (!moneyOnRight) return [];
    return [0, 0.5, 1].map((p) => ({
      p,
      y: padT + innerH * (1 - p),
      label: fmtAxisTick(moneyMax * p),
    }));
  }, [moneyOnRight, moneyMax, innerH]);
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const n = series.labels.length;
    if (n === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * w;
    const idx = Math.round(((x - padL) / Math.max(innerW, 1)) * (n - 1));
    setHoverIdx(Math.max(0, Math.min(n - 1, idx)));
  };

  const toggleSeries = (key: SeriesKey) => {
    setEnabled((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      const stillOn = available.some((d) => next[d.key]);
      return stillOn ? next : prev;
    });
  };

  if (!trends.length || allZero) {
    return (
      <div className="card glass-card flex h-[240px] flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="text-sm text-ink-muted">{t("trendColdStart")}</p>
        <p className="text-xs text-ink-subtle">{t("trendColdStartHint")}</p>
      </div>
    );
  }

  const tipIdx = hoverIdx;
  const tipDate = tipIdx != null ? series.dates[tipIdx] : null;
  const tipSeries = active.length ? active : available;

  return (
    <div className="card glass-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-ink">{t("trend")}</h2>
          {commercialCold ? (
            <p className="mt-0.5 text-xs text-ink-subtle">{t("trendCommercialCold")}</p>
          ) : (
            <p className="mt-0.5 text-xs text-ink-subtle">{t("tipTrendScale")}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs text-ink-muted" role="group" aria-label={t("trend")}>
          {available.map((l) => {
            const on = enabled[l.key] && active.some((a) => a.key === l.key);
            return (
              <button
                key={l.key}
                type="button"
                aria-pressed={on}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 transition ${
                  on
                    ? "border-line bg-panel text-ink"
                    : "border-transparent text-ink-subtle opacity-55 hover:opacity-80"
                }`}
                onClick={() => toggleSeries(l.key)}
              >
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: l.color }} />
                {l.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="h-auto w-full"
          role="img"
          aria-label={t("trend")}
          onPointerMove={onMove}
          onPointerLeave={() => setHoverIdx(null)}
        >
          {[0.25, 0.5, 0.75, 1].map((p) => {
            const y = padT + innerH * (1 - p);
            return (
              <line
                key={p}
                x1={padL}
                x2={w - padR}
                y1={y}
                y2={y}
                stroke="rgba(15,20,25,0.08)"
                strokeWidth="1"
              />
            );
          })}
          {leftTicks.map((tick) => (
            <text
              key={`l-${tick.p}`}
              x={padL - 6}
              y={tick.y + 3}
              textAnchor="end"
              className="fill-ink-subtle"
              style={{ fontSize: 9 }}
            >
              {tick.label}
            </text>
          ))}
          {rightTicks.map((tick) => (
            <text
              key={`r-${tick.p}`}
              x={w - padR + 6}
              y={tick.y + 3}
              textAnchor="start"
              className="fill-ink-subtle"
              style={{ fontSize: 9 }}
            >
              {tick.label}
            </text>
          ))}
          {lines.map((l) => (
            <polyline
              key={l.key}
              fill="none"
              stroke={l.color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={l.points}
              opacity={commercialCold && l.commercial ? 0.35 : 1}
            />
          ))}
          {tipIdx != null ? (
            <line
              x1={
                padL +
                (series.labels.length === 1
                  ? innerW / 2
                  : (tipIdx / (series.labels.length - 1)) * innerW)
              }
              x2={
                padL +
                (series.labels.length === 1
                  ? innerW / 2
                  : (tipIdx / (series.labels.length - 1)) * innerW)
              }
              y1={padT}
              y2={padT + innerH}
              stroke="rgba(15,20,25,0.2)"
              strokeWidth="1"
              strokeDasharray="4 3"
            />
          ) : null}
          {series.labels.map((label, i) => {
            const n = series.labels.length;
            if (n > 14 && i % Math.ceil(n / 8) !== 0 && i !== n - 1) return null;
            const x = padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
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
        {tipIdx != null && tipDate ? (
          <div className="pointer-events-none absolute left-1/2 top-2 z-10 min-w-[160px] -translate-x-1/2 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-sm">
            <p className="mb-1 font-medium text-ink">{tipDate}</p>
            {tipSeries.map((d) => (
              <p key={d.key} className="flex items-center justify-between gap-4 text-ink-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: d.color }} />
                  {d.label}
                </span>
                <span className="tabular-nums text-ink">{fmtNum(d.values[tipIdx])}</span>
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function AdminDashboardPage() {
  const { t, locale } = useI18n();
  const search = useLocationSearchParams();
  const rangeParam = search.get("range");
  const urlFrom = search.get("from");
  const urlTo = search.get("to");

  const range: DashboardRange =
    rangeParam === "today" || rangeParam === "7d" || rangeParam === "30d"
      ? rangeParam
      : rangeParam === "custom" || (Boolean(urlFrom) && Boolean(urlTo))
        ? "custom"
        : "7d";

  const appliedCustom = useMemo(() => {
    if (range !== "custom") return null;
    const fallback = defaultCustomRange();
    const from = urlFrom && parseDayLocal(urlFrom) ? urlFrom : fallback.from;
    const to = urlTo && parseDayLocal(urlTo) ? urlTo : fallback.to;
    return { from, to };
  }, [range, urlFrom, urlTo]);

  const [draftFrom, setDraftFrom] = useState(() => appliedCustom?.from ?? defaultCustomRange().from);
  const [draftTo, setDraftTo] = useState(() => appliedCustom?.to ?? defaultCustomRange().to);
  const [rangeError, setRangeError] = useState<string | null>(null);

  useEffect(() => {
    if (appliedCustom) {
      setDraftFrom(appliedCustom.from);
      setDraftTo(appliedCustom.to);
      setRangeError(null);
    }
  }, [appliedCustom]);

  const rankTab = parseRank(search.get("rank"));
  const todayKey = dayKeyLocal(new Date());

  const customSpan =
    appliedCustom != null ? inclusiveDaySpan(appliedCustom.from, appliedCustom.to) : null;
  const queryEnabled =
    range !== "custom" || (customSpan != null && customSpan >= 1 && customSpan <= CUSTOM_MAX_DAYS);

  const { data, error, isFetching, isPending, dataUpdatedAt, refetch } = useQuery({
    queryKey: ["admin", "dashboard", range, appliedCustom?.from ?? null, appliedCustom?.to ?? null],
    queryFn: () =>
      adminDashboard(
        range,
        range === "custom" && appliedCustom
          ? { from: appliedCustom.from, to: appliedCustom.to }
          : undefined,
      ),
    enabled: queryEnabled,
  });

  const showKpiSkeleton = isPending || (isFetching && !data);

  const applyCustomRange = () => {
    const span = inclusiveDaySpan(draftFrom, draftTo);
    if (span == null) {
      setRangeError(t("customRangeErrorOrder"));
      return;
    }
    if (span > CUSTOM_MAX_DAYS) {
      setRangeError(t("customRangeErrorMax", { days: CUSTOM_MAX_DAYS }));
      return;
    }
    setRangeError(null);
    patchDashboardUrl({ range: "custom", from: draftFrom, to: draftTo });
  };

  const selectPreset = (id: Exclude<DashboardRange, "custom">) => {
    setRangeError(null);
    patchDashboardUrl({ range: id, from: null, to: null });
  };

  const selectCustomTab = () => {
    const next = appliedCustom ?? defaultCustomRange();
    setDraftFrom(next.from);
    setDraftTo(next.to);
    setRangeError(null);
    patchDashboardUrl({ range: "custom", from: next.from, to: next.to });
  };

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
  }, [todos, t]);

  const hasOpenTodos = todoItems.some((x) => x.n > 0 || ("warn" in x && (x.warn as number) > 0));

  const viewColumns: Column<DramaRankRow>[] = useMemo(
    () => [
      {
        key: "title",
        header: t("drama"),
        cell: (row) => (
          <Link href={`/content/${row.id}`} className="text-brand hover:underline">
            {row.titleZh || row.titleEn || "—"}
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
            {r.titleZh || r.titleEn || "—"}
          </Link>
        ),
      },
      { key: "orders", header: t("orderCount"), cell: (r) => String(r.orderCount ?? 0) },
      { key: "credits", header: t("colCredits"), cell: (r) => fmtNum(r.credits), className: "tabular-nums" },
      { key: "vnd", header: "USD", cell: (r) => fmtNum(r.amountVnd), className: "tabular-nums" },
    ],
    [t],
  );

  const period = data?.period;
  const deltas = data?.deltas;
  const biz = data?.bizBreakdown;
  const dramaCount = data?.meta?.dramaCount ?? 0;

  const rankEmptyTitle =
    dramaCount === 0 ? t("rankEmptyNoContent") : t("rankEmptyNoPeriodData");
  const rankEmptyDescription =
    dramaCount === 0 ? t("rankEmptyNoContentHint") : t("rankEmptyNoPeriodDataHint");

  const vsTip = range === "custom" ? t("tipVsLastPeriodCustom") : t("tipVsLastPeriod");
  const tipLabel = t("tipMoreInfo");

  return (
    <AdminShell title={t("dashboard")}>
      {error ? (
        <p className="mb-4 rounded-xl border border-danger/20 bg-danger-soft px-3 py-2 text-body-sm text-danger">
          {(error as Error).message || "failed"}
        </p>
      ) : null}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-line bg-surface p-1">
            {RANGE_KEYS.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  range === r.id ? "bg-brand text-white" : "text-ink-muted hover:text-ink"
                }`}
                onClick={() => selectPreset(r.id)}
              >
                {t(r.labelKey)}
              </button>
            ))}
            <button
              type="button"
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                range === "custom" ? "bg-brand text-white" : "text-ink-muted hover:text-ink"
              }`}
              onClick={selectCustomTab}
            >
              {t("rangeCustom")}
            </button>
          </div>
          {range === "custom" ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-ink-muted">
                <span className="sr-only">{t("rangeFrom")}</span>
                <input
                  type="date"
                  value={draftFrom}
                  max={draftTo || todayKey}
                  className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                  onChange={(e) => setDraftFrom(e.target.value)}
                />
              </label>
              <span className="text-xs text-ink-subtle">–</span>
              <label className="flex items-center gap-1.5 text-xs text-ink-muted">
                <span className="sr-only">{t("rangeTo")}</span>
                <input
                  type="date"
                  value={draftTo}
                  min={draftFrom || undefined}
                  max={todayKey}
                  className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                  onChange={(e) => setDraftTo(e.target.value)}
                />
              </label>
              <button
                type="button"
                className={buttonVariants({ variant: "secondary", size: "sm" })}
                onClick={applyCustomRange}
              >
                {t("rangeApply")}
              </button>
              <span className="text-[11px] text-ink-subtle">{t("customRangeHint", { days: CUSTOM_MAX_DAYS })}</span>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {dataUpdatedAt ? (
            <p className="text-xs text-ink-subtle">
              {t("dataAsOf", { time: formatAsOf(dataUpdatedAt, locale) })}
            </p>
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
      {rangeError ? (
        <p className="mb-4 text-xs text-danger">{rangeError}</p>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        {showKpiSkeleton ? (
          <>
            {Array.from({ length: 5 }).map((_, i) => (
              <KpiSkeleton key={i} />
            ))}
          </>
        ) : (
          <>
            <KpiCard
              label={t("kpiNewUsers")}
              value={period?.newUsers ?? "—"}
              delta={deltas?.newUsersPct}
              vsLabel={t("vsLastPeriod")}
              tip={`${t("tipKpiNewUsers")} · ${vsTip}`}
              tipLabel={tipLabel}
              prevZeroHint={t("kpiPrevWasZero")}
            />
            <KpiCard
              label={t("kpiGmv")}
              value={fmtNum(period?.gmvVnd)}
              delta={deltas?.gmvPct}
              vsLabel={t("vsLastPeriod")}
              tip={`${t("tipKpiGmv")} · ${vsTip}`}
              tipLabel={tipLabel}
              prevZeroHint={t("kpiPrevWasZero")}
            />
            <KpiCard
              label={t("kpiUnlocks")}
              value={period?.unlockCount ?? "—"}
              delta={deltas?.unlockPct}
              vsLabel={t("vsLastPeriod")}
              tip={`${t("tipKpiUnlocks")} · ${vsTip}`}
              tipLabel={tipLabel}
              prevZeroHint={t("kpiPrevWasZero")}
            />
            <KpiCard
              label={t("kpiRevenue")}
              value={fmtNum(period?.platformRevenueVnd)}
              delta={deltas?.revenuePct}
              vsLabel={t("vsLastPeriod")}
              tip={`${t("tipKpiRevenue")} · ${vsTip}`}
              tipLabel={tipLabel}
              prevZeroHint={t("kpiPrevWasZero")}
            />
            <KpiCard
              label={t("kpiOrders")}
              value={period?.paidOrders ?? "—"}
              delta={deltas?.ordersPct}
              vsLabel={t("vsLastPeriod")}
              tip={`${t("tipKpiOrders")} · ${vsTip}`}
              tipLabel={tipLabel}
              prevZeroHint={t("kpiPrevWasZero")}
            />
          </>
        )}
      </div>

      <div className="mb-6">
        <TrendChart trends={data?.trends ?? []} t={t} />
      </div>

      <h2 className="mb-3 text-base font-semibold text-ink">{t("todos")}</h2>
      {data && !hasOpenTodos ? (
        <p className="mb-8 text-sm text-ink-muted">{t("todosEmpty")}</p>
      ) : (
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
                  x.n > 0 ? "text-warning" : "text-ink"
                }`}
              >
                {x.n}
              </p>
              {"warn" in x && (x.warn as number) > 0 ? (
                <p className="mt-1 text-xs font-medium text-danger">
                  {t("overdue")}: {x.warn as number}
                </p>
              ) : null}
            </Link>
          ))}
        </div>
      )}

      <h2 className="mb-3 text-base font-semibold text-ink">{t("bizBreakdown")}</h2>
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <TippedStat
          label={t("activeVip")}
          tip={t("tipActiveVip")}
          tipLabel={tipLabel}
          value={biz?.activeVipUsers ?? "—"}
        />
        <TippedStat
          label={t("topupStat")}
          tip={t("tipTopupStat")}
          tipLabel={tipLabel}
          value={`${biz?.topup?.count ?? 0} / ${fmtNum(biz?.topup?.credits)}`}
        />
        <TippedStat
          label={t("vipStat")}
          tip={t("tipVipStat")}
          tipLabel={tipLabel}
          value={`${biz?.vip?.count ?? 0} / ${fmtNum(biz?.vip?.amountVnd)}`}
        />
        <TippedStat
          label={t("unlockStat")}
          tip={t("tipUnlockStat")}
          tipLabel={tipLabel}
          value={`${biz?.unlock?.count ?? 0} / ${fmtNum(biz?.unlock?.credits)}`}
        />
        <TippedStat
          label={t("buyoutStat")}
          tip={t("tipBuyoutStat")}
          tipLabel={tipLabel}
          value={`${biz?.dramaBuyout?.count ?? 0} / ${fmtNum(biz?.dramaBuyout?.credits)}`}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-ink">
          {t("rankings")}
          <TipHint text={t("tipRankings")} label={tipLabel} />
        </h2>
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
              onClick={() => patchDashboardUrl({ rank: tab.id })}
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
          emptyTitle={rankEmptyTitle}
          emptyDescription={rankEmptyDescription}
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
          emptyTitle={rankEmptyTitle}
          emptyDescription={rankEmptyDescription}
          getRowKey={(r) => String(r.id)}
        />
      )}
    </AdminShell>
  );
}

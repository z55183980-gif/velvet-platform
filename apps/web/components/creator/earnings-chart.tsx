"use client";

import { useLocale } from "@/lib/i18n";
import { formatCreatorUsd } from "@/lib/creator-money";

export function EarningsChart({
  rows,
}: {
  rows: { day: string; totalVnd: string; orders: number }[];
}) {
  const { t } = useLocale();

  if (!rows.length) {
    return <p className="mt-4 text-body-sm text-ink-muted">{t("creator.emptyData")}</p>;
  }

  const vals = rows.map((r) => Number(r.totalVnd || 0));
  const max = Math.max(...vals, 1);
  const w = Math.max(320, rows.length * 18);
  const h = 120;
  const pad = 8;
  const points = vals
    .map((v, i) => {
      const x = pad + (i * (w - pad * 2)) / Math.max(rows.length - 1, 1);
      const y = h - pad - (v / max) * (h - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");
  const total = vals.reduce((a, b) => a + b, 0);

  return (
    <div className="mt-4 rounded-xl border border-line bg-surface-2 p-4">
      <p className="mb-2 text-caption text-ink-subtle">
        {t("creator.chartTotal")}: {formatCreatorUsd(total)}
      </p>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-32 w-full" role="img" aria-label="earnings">
        <polyline fill="none" stroke="var(--color-brand)" strokeWidth="2" points={points} />
        {vals.map((v, i) => {
          const x = pad + (i * (w - pad * 2)) / Math.max(rows.length - 1, 1);
          const y = h - pad - (v / max) * (h - pad * 2);
          return <circle key={rows[i].day} cx={x} cy={y} r="2.5" fill="var(--color-brand)" />;
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-ink-subtle">
        <span>{rows[0]?.day?.slice(5)}</span>
        <span>{rows[rows.length - 1]?.day?.slice(5)}</span>
      </div>
    </div>
  );
}

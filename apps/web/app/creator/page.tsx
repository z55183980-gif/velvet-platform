"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n";
import { buttonVariants } from "@/components/ui/button";
import { creatorApi } from "@/lib/creator-api";
import { formatApiError, useToast } from "@/components/toast";
import { EarningsChart } from "@/components/creator/earnings-chart";
import { cn } from "@/lib/utils";
import { formatCreatorUsd } from "@/lib/creator-money";

export default function CreatorOverviewPage() {
  const { t } = useLocale();
  const toast = useToast();
  const [dash, setDash] = useState<any>(null);
  const [daily, setDaily] = useState<{ day: string; totalVnd: string; orders: number }[]>([]);
  const [earnDays, setEarnDays] = useState<7 | 30>(7);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [d, earn] = await Promise.all([
        creatorApi<any>("/dashboard"),
        creatorApi<{ rows: { day: string; totalVnd: string; orders: number }[] }>(
          `/earnings/daily?days=${earnDays}`,
        ),
      ]);
      setDash(d);
      setDaily(earn?.rows || []);
    } catch (e: unknown) {
      const msg = formatApiError(e, "error");
      setErr(msg);
      toast.error(msg);
    }
  }, [earnDays, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <h2 className="text-h3 font-semibold text-ink">{t("creator.overviewTitle")}</h2>

      {err && (
        <p role="alert" className="mt-4 rounded-md border border-danger/40 bg-surface px-3 py-2 text-caption text-danger">
          {err}
        </p>
      )}

      {dash && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            [t("creator.available"), dash.availableVnd],
            [t("creator.pending"), dash.pendingVnd],
            [t("creator.totalEarned"), dash.totalEarnedVnd],
            [t("creator.dramaCount"), dash.dramas],
          ].map(([label, val]) => (
            <div key={String(label)} className="rounded-xl border border-line bg-surface-2 px-4 py-4">
              <div className="text-caption text-ink-subtle">{label}</div>
              <div className="mt-1 text-h4 font-semibold tabular-nums text-ink">
                {formatCreatorUsd(val)}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/creator/works" className={cn(buttonVariants({ variant: "primary" }))}>
          {t("creator.quickCreate")}
        </Link>
        <Link href="/creator/upload" className={cn(buttonVariants({ variant: "secondary" }))}>
          {t("creator.quickUpload")}
        </Link>
        <Link href="/creator/wallet" className={cn(buttonVariants({ variant: "ghost" }))}>
          {t("creator.quickWallet")}
        </Link>
      </div>

      <section className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-h3 font-semibold text-ink">{t("creator.earnTrend")}</h3>
          <div className="flex gap-2">
            {([7, 30] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setEarnDays(d)}
                className={`rounded-md px-2.5 py-1 text-xs ${
                  earnDays === d ? "bg-brand text-white" : "border border-line text-ink-muted"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
        <EarningsChart rows={daily} />
      </section>
    </div>
  );
}

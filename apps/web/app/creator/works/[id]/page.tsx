"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useLocale } from "@/lib/i18n";
import { buttonVariants } from "@/components/ui/button";
import { creatorApi } from "@/lib/creator-api";
import { formatApiError, useToast } from "@/components/toast";
import { track } from "@/lib/track";
import { cn } from "@/lib/utils";

export default function CreatorWorkDetailPage() {
  const params = useParams();
  const id = String(params?.id || "");
  const { t } = useLocale();
  const toast = useToast();
  const [drama, setDrama] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fail = useCallback(
    (e: unknown, fallback: string) => {
      const msg = formatApiError(e, fallback);
      setErr(msg);
      toast.error(msg);
    },
    [toast],
  );

  const reload = useCallback(async () => {
    if (!id) return;
    setErr(null);
    try {
      const list = await creatorApi<any[]>("/dramas");
      const found = (list || []).find((d) => String(d.id) === id) || null;
      setDrama(found);
    } catch (e: unknown) {
      fail(e, "error");
    }
  }, [id, fail]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function submitReview() {
    setBusy(true);
    try {
      await creatorApi(`/dramas/${id}/submit-review`, { method: "POST", body: "{}" });
      track("submit_drama", { dramaId: id });
      await reload();
    } catch (e: unknown) {
      fail(e, "submit failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeEpisode(epId: string) {
    if (!window.confirm(t("creator.confirmDeleteEp"))) return;
    setBusy(true);
    try {
      await creatorApi(`/episodes/${epId}`, { method: "DELETE" });
      await reload();
    } catch (e: unknown) {
      fail(e, "delete ep failed");
    } finally {
      setBusy(false);
    }
  }

  if (!drama && !err) {
    return <p className="text-body-sm text-ink-muted">{t("common.loading")}</p>;
  }

  if (!drama) {
    return (
      <div>
        <p className="text-body text-ink-muted">{t("creator.notFoundWork")}</p>
        <Link href="/creator/works" className={cn(buttonVariants({ variant: "secondary" }), "mt-4 inline-flex")}>
          {t("creator.backWorks")}
        </Link>
      </div>
    );
  }

  const episodes = drama.episodes || [];

  return (
    <div>
      <Link href="/creator/works" className="text-body-sm text-ink-muted hover:text-ink">
        ← {t("creator.backWorks")}
      </Link>
      <h2 className="mt-3 text-h3 font-semibold text-ink">{drama.titleEn}</h2>
      <p className="mt-1 text-caption text-ink-subtle">
        {drama.status} · {drama.slug} · {episodes.length} ep
      </p>

      {err && (
        <p role="alert" className="mt-4 rounded-md border border-danger/40 bg-surface px-3 py-2 text-caption text-danger">
          {err}
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href={`/creator/upload?dramaId=${id}`}
          className={buttonVariants({ variant: "primary" })}
        >
          {t("creator.addEpisodes")}
        </Link>
        {drama.status === "DRAFT" && (
          <button
            type="button"
            disabled={busy}
            className={buttonVariants({ variant: "secondary" })}
            onClick={() => void submitReview()}
          >
            {t("creator.submitReview")}
          </button>
        )}
      </div>

      <section className="mt-10">
        <h3 className="text-h3 font-semibold text-ink">{t("creator.episodeStatus")}</h3>
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
          {episodes.length === 0 && (
            <li className="px-4 py-6 text-ink-subtle">{t("creator.emptyEpisodes")}</li>
          )}
          {episodes.map((ep: any) => (
            <li key={String(ep.id)} className="flex flex-wrap justify-between gap-2 px-4 py-3 text-body-sm">
              <span className="text-ink">
                ep{ep.episodeNumber}
                {ep.title ? ` · ${ep.title}` : ""}
              </span>
              <span className="flex items-center gap-3 text-ink-subtle">
                {ep.transcodeStatus || "—"} · {ep.hlsUrl || ep.originalUrl || "no url"}
                {drama.status === "DRAFT" && (
                  <button
                    type="button"
                    className="text-xs text-ink-muted hover:text-red-400"
                    onClick={() => void removeEpisode(String(ep.id))}
                  >
                    {t("creator.delete")}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

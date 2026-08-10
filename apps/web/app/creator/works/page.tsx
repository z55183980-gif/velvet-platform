"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n";
import { buttonVariants } from "@/components/ui/button";
import { creatorApi } from "@/lib/creator-api";
import { formatApiError, useToast } from "@/components/toast";
import { track } from "@/lib/track";

export default function CreatorWorksPage() {
  const { t } = useLocale();
  const toast = useToast();
  const [dramas, setDramas] = useState<any[]>([]);
  const [titleEn, setTitleEn] = useState("");
  const [titleZh, setTitleZh] = useState("");
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
    setErr(null);
    try {
      const list = await creatorApi<any[]>("/dramas");
      setDramas(list || []);
    } catch (e: unknown) {
      fail(e, "error");
    }
  }, [fail]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function createDrama() {
    if (!titleEn.trim()) return;
    setBusy(true);
    try {
      await creatorApi("/dramas", {
        method: "POST",
        body: JSON.stringify({ titleEn, titleZh: titleZh || titleEn }),
      });
      track("create_drama", {});
      setTitleEn("");
      setTitleZh("");
      await reload();
    } catch (e: unknown) {
      fail(e, "create failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitReview(id: string) {
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

  async function patchDrama(id: string) {
    const title = window.prompt(t("creator.promptTitle"));
    if (!title?.trim()) return;
    setBusy(true);
    try {
      await creatorApi(`/dramas/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ titleEn: title.trim() }),
      });
      await reload();
    } catch (e: unknown) {
      fail(e, "update failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeDrama(id: string) {
    if (!window.confirm(t("creator.confirmDeleteDraft"))) return;
    setBusy(true);
    try {
      await creatorApi(`/dramas/${id}`, { method: "DELETE" });
      await reload();
    } catch (e: unknown) {
      fail(e, "delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function offlineDrama(id: string) {
    if (!window.confirm(t("creator.confirmOffline"))) return;
    setBusy(true);
    try {
      await creatorApi(`/dramas/${id}/offline`, { method: "POST", body: "{}" });
      await reload();
    } catch (e: unknown) {
      fail(e, "offline failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 className="text-h3 font-semibold text-ink">{t("creator.worksTitle")}</h2>

      {err && (
        <p role="alert" className="mt-4 rounded-md border border-danger/40 bg-surface px-3 py-2 text-caption text-danger">
          {err}
        </p>
      )}

      <section className="mt-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            className="rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink"
            placeholder={t("creator.titleVi")}
            value={titleEn}
            onChange={(e) => setTitleEn(e.target.value)}
          />
          <input
            className="rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink"
            placeholder={t("creator.titleZh")}
            value={titleZh}
            onChange={(e) => setTitleZh(e.target.value)}
          />
          <button
            type="button"
            disabled={busy}
            className={buttonVariants({ variant: "primary" })}
            onClick={() => void createDrama()}
          >
            {t("creator.createDraft")}
          </button>
        </div>
      </section>

      <ul className="mt-8 divide-y divide-line rounded-xl border border-line">
        {dramas.length === 0 && (
          <li className="px-4 py-6 text-body-sm text-ink-subtle">{t("creator.emptyWorks")}</li>
        )}
        {dramas.map((d) => (
          <li key={String(d.id)} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <div className="text-body font-medium text-ink">{d.titleEn}</div>
              <div className="text-caption text-ink-subtle">
                {d.status} · {d._count?.episodes ?? 0} ep · {d.slug}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/creator/works/${d.id}`}
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                {t("creator.manage")}
              </Link>
              <button
                type="button"
                disabled={busy}
                className={buttonVariants({ variant: "ghost", size: "sm" })}
                onClick={() => void patchDrama(String(d.id))}
              >
                {t("creator.edit")}
              </button>
              {d.status === "DRAFT" && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    className={buttonVariants({ variant: "secondary", size: "sm" })}
                    onClick={() => void submitReview(String(d.id))}
                  >
                    {t("creator.submitReview")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className={buttonVariants({ variant: "ghost", size: "sm" })}
                    onClick={() => void removeDrama(String(d.id))}
                  >
                    {t("creator.delete")}
                  </button>
                </>
              )}
              {d.status === "LIVE" && (
                <button
                  type="button"
                  disabled={busy}
                  className={buttonVariants({ variant: "secondary", size: "sm" })}
                  onClick={() => void offlineDrama(String(d.id))}
                >
                  {t("creator.offline")}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Download, Share, Smartphone, X } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { useDialogFocus } from "@/hooks/use-dialog-focus";
import {
  getPwaPlatform,
  hasSeenPwaPrompt,
  isPwaStandalone,
  markPwaPromptSeen,
  onOpenPwaInstallGuide,
  registerPwaServiceWorker,
  type PwaPlatform,
} from "@/lib/pwa";
import { cn } from "@/lib/utils";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export function PwaInstallRoot() {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<PwaPlatform>("other");
  const [standalone, setStandalone] = useState(true);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installing, setInstalling] = useState(false);
  const dialogRef = useDialogFocus<HTMLDivElement>(open && !standalone, () => {
    if (!installing) close(true);
  });

  useEffect(() => {
    void registerPwaServiceWorker();
    setPlatform(getPwaPlatform());
    setStandalone(isPwaStandalone());
  }, []);

  useEffect(() => {
    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  useEffect(() => {
    return onOpenPwaInstallGuide(() => {
      if (isPwaStandalone()) return;
      setPlatform(getPwaPlatform());
      setStandalone(false);
      setOpen(true);
    });
  }, []);

  useEffect(() => {
    if (standalone) return;
    if (hasSeenPwaPrompt()) return;
    const p = getPwaPlatform();
    if (p !== "ios" && p !== "android") return;
    const visitKey = "velvet_pwa_visits";
    const sessionKey = "velvet_pwa_visit_counted";
    let visits = 1;
    try {
      visits = Number(window.localStorage.getItem(visitKey) || "0");
      if (!window.sessionStorage.getItem(sessionKey)) {
        visits += 1;
        window.localStorage.setItem(visitKey, String(visits));
        window.sessionStorage.setItem(sessionKey, "1");
      }
    } catch {
      return;
    }
    if (visits < 2) return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== "visible" || isPwaStandalone() || hasSeenPwaPrompt()) return;
      setPlatform(p);
      setOpen(true);
    }, 45_000);
    return () => window.clearTimeout(timer);
  }, [standalone]);

  function close(markSeen = true) {
    setOpen(false);
    if (markSeen) markPwaPromptSeen();
  }

  async function onAndroidInstall() {
    if (!deferred) return;
    setInstalling(true);
    try {
      await deferred.prompt();
      await deferred.userChoice;
      setDeferred(null);
      close(true);
    } catch {
      /* keep sheet open for manual steps */
    } finally {
      setInstalling(false);
    }
  }

  if (!open || standalone) return null;

  const isIos = platform === "ios";
  const isAndroid = platform === "android";

  return (
    <div className="fixed inset-0 z-[80] md:hidden">
      <div
        className="absolute inset-0 bg-black/40"
        aria-hidden="true"
        onClick={() => {
          if (!installing) close(true);
        }}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pwa-dialog-title"
        aria-describedby="pwa-dialog-description"
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-3xl border border-white/10 bg-base/70 pb-[calc(1rem+var(--mobile-tab-safe-bottom))] shadow-2xl backdrop-blur-xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-base/50 px-4 py-3 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-brand" />
            <h2 id="pwa-dialog-title" className="text-body font-semibold text-ink">{t("pwa.title")}</h2>
          </div>
          <button
            type="button"
            onClick={() => close(true)}
            disabled={installing}
            data-dialog-initial-focus
            className="grid h-11 w-11 place-items-center rounded-full text-ink-muted hover:bg-white/10"
            aria-label={t("pwa.close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <p id="pwa-dialog-description" className="text-body-sm text-ink-muted">
            {t("pwa.subtitle")}
          </p>

          {isAndroid && (
            <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
              <p className="text-overline uppercase tracking-widest text-ink-subtle">
                {t("pwa.androidBadge")}
              </p>
              <p className="text-body-sm text-ink">{t("pwa.androidBody")}</p>
              {deferred ? (
                <button
                  type="button"
                  disabled={installing}
                  onClick={() => void onAndroidInstall()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand px-4 py-3 text-body-sm font-semibold text-white disabled:opacity-60"
                >
                  <Download className="h-4 w-4" />
                  {installing ? t("pwa.installing") : t("pwa.androidInstall")}
                </button>
              ) : (
                <ol className="list-decimal space-y-2 pl-5 text-body-sm text-ink-muted">
                  <li>{t("pwa.androidStep1")}</li>
                  <li>{t("pwa.androidStep2")}</li>
                  <li>{t("pwa.androidStep3")}</li>
                </ol>
              )}
            </div>
          )}

          {isIos && (
            <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
              <p className="text-overline uppercase tracking-widest text-ink-subtle">
                {t("pwa.iosBadge")}
              </p>
              <p className="text-body-sm text-ink">{t("pwa.iosBody")}</p>
              <ol className="space-y-3 text-body-sm text-ink-muted">
                <li className="flex gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-caption font-semibold text-ink">
                    1
                  </span>
                  <span className="pt-0.5">
                    {t("pwa.iosStep1")}{" "}
                    <Share className="inline-block h-4 w-4 align-text-bottom text-brand" />
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-caption font-semibold text-ink">
                    2
                  </span>
                  <span className="pt-0.5">{t("pwa.iosStep2")}</span>
                </li>
                <li className="flex gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-caption font-semibold text-ink">
                    3
                  </span>
                  <span className="pt-0.5">{t("pwa.iosStep3")}</span>
                </li>
              </ol>
              <p className="text-caption text-ink-subtle">{t("pwa.iosSafariHint")}</p>
            </div>
          )}

          {!isIos && !isAndroid && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
              <p className="text-body-sm text-ink-muted">{t("pwa.otherBody")}</p>
            </div>
          )}

          <button
            type="button"
            onClick={() => close(true)}
            disabled={installing}
            className={cn(
              "min-h-11 w-full rounded-full px-4 py-3 text-body-sm font-medium disabled:opacity-60",
              "bg-white/10 text-ink hover:bg-white/15",
            )}
          >
            {t("pwa.later")}
          </button>
        </div>
      </div>
    </div>
  );
}

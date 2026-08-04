"use client";

import { useEffect, useState } from "react";
import { Download, Share, Smartphone, X } from "lucide-react";
import { useLocale } from "@/lib/i18n";
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
    // First-visit auto prompt: mobile only (iOS / Android).
    if (p !== "ios" && p !== "android") return;
    const timer = window.setTimeout(() => {
      if (isPwaStandalone() || hasSeenPwaPrompt()) return;
      setPlatform(p);
      setOpen(true);
    }, 1800);
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
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label={t("pwa.close")}
        onClick={() => close(true)}
      />
      <div className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-3xl border border-white/10 bg-base/70 pb-[calc(1rem+var(--mobile-tab-safe-bottom))] shadow-2xl backdrop-blur-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-base/50 px-4 py-3 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-brand" />
            <h2 className="text-body font-semibold text-ink">{t("pwa.title")}</h2>
          </div>
          <button
            type="button"
            onClick={() => close(true)}
            className="grid h-9 w-9 place-items-center rounded-full text-ink-muted hover:bg-white/10"
            aria-label={t("pwa.close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <p className="text-body-sm text-ink-muted">{t("pwa.subtitle")}</p>

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
            className={cn(
              "w-full rounded-full px-4 py-3 text-body-sm font-medium",
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

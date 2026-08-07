"use client";

import { useState } from "react";
import Link from "next/link";
import { Clapperboard, Coins, Upload, Wallet } from "lucide-react";
import { useAuth } from "@/components/auth-context";
import { useLocale } from "@/lib/i18n";
import { buttonVariants } from "@/components/ui/button";
import { creatorActivate, getSession } from "@/lib/api";
import { formatApiError, useToast } from "@/components/toast";
import { track } from "@/lib/track";
import { cn } from "@/lib/utils";

export function CreatorGate({ onActivated }: { onActivated?: () => void }) {
  const { user, openLogin, applySession } = useAuth();
  const { t } = useLocale();
  const toast = useToast();
  const [activating, setActivating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const benefits = [
    { icon: Upload, text: t("creator.benefitUpload") },
    { icon: Coins, text: t("creator.benefitShare") },
    { icon: Wallet, text: t("creator.benefitWithdraw") },
  ] as const;

  async function handleActivate() {
    if (!user) {
      openLogin();
      return;
    }
    setActivating(true);
    setErr(null);
    try {
      await creatorActivate();
      track("creator_activate");
      const session = await getSession();
      await applySession({ ...(session || {}), isCreator: true });
      onActivated?.();
    } catch (e: unknown) {
      const msg = formatApiError(e, t("creator.openTitle"));
      setErr(msg);
      toast.error(msg);
    } finally {
      setActivating(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-6 py-16 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-full bg-brand/10 text-brand">
        <Clapperboard className="h-8 w-8" aria-hidden />
      </span>
      <p className="mt-6 text-caption font-medium uppercase tracking-wide text-ink-subtle">
        {t("creator.title")}
      </p>
      <h1 className="mt-2 text-h2 font-bold text-ink">{t("creator.openTitle")}</h1>
      <p className="mt-3 max-w-md text-body text-ink-muted">{t("creator.openBody")}</p>
      <ul className="mt-8 w-full space-y-3 text-left">
        {benefits.map(({ icon: Icon, text }) => (
          <li
            key={text}
            className="flex items-start gap-3 rounded-lg border border-line bg-surface-2 px-4 py-3 text-body-sm text-ink"
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
            <span>{text}</span>
          </li>
        ))}
      </ul>
      {err && (
        <p role="alert" className="mt-4 text-caption text-danger">
          {err}
        </p>
      )}
      <div className="mt-8 flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
        <button
          type="button"
          className={cn(buttonVariants({ variant: "primary", size: "lg" }), "w-full sm:w-auto")}
          disabled={activating}
          onClick={() => void handleActivate()}
        >
          {activating
            ? t("creator.activating")
            : user
              ? t("creator.confirm")
              : t("creator.loginToOpen")}
        </button>
        <Link
          href="/"
          className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "w-full sm:w-auto")}
        >
          {t("creator.cancel")}
        </Link>
      </div>
    </main>
  );
}

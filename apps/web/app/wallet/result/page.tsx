"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, X } from "lucide-react";
import { useAuth } from "@/components/auth-context";
import { useLocale } from "@/lib/i18n";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function WalletResultInner() {
  const { t } = useLocale();
  const { refreshWallet, applySession } = useAuth();
  const params = useSearchParams();
  const status = (params.get("status") || "").toLowerCase();
  const success = status === "success" || status === "paid";

  useEffect(() => {
    if (!success) return;
    void refreshWallet();
    void applySession();
  }, [success, refreshWallet, applySession]);

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-6 py-16 text-center">
      <span
        className={cn(
          "grid h-16 w-16 place-items-center rounded-full",
          success ? "bg-success/15 text-success" : "bg-surface-2 text-ink-muted",
        )}
      >
        {success ? <Check className="h-8 w-8" /> : <X className="h-8 w-8" />}
      </span>
      <h1 className="mt-6 text-h2 font-bold text-ink">
        {success ? t("walletResult.successTitle") : t("walletResult.cancelTitle")}
      </h1>
      <p className="mt-3 max-w-md text-body text-ink-muted">
        {success ? t("walletResult.successBody") : t("walletResult.cancelBody")}
      </p>
      <Link href="/me" className={cn(buttonVariants({ variant: "primary", size: "lg" }), "mt-8")}>
        {t("walletResult.backMe")}
      </Link>
    </main>
  );
}

export default function WalletResultPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-[70vh] max-w-lg items-center justify-center px-6 py-16 text-ink-muted">
          Loading…
        </main>
      }
    >
      <WalletResultInner />
    </Suspense>
  );
}

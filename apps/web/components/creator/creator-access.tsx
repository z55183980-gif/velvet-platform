"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth-context";
import { useLocale } from "@/lib/i18n";
import { creatorStatus, getSession } from "@/lib/api";
import { CreatorGate } from "@/components/creator/creator-gate";
import { CreatorShell } from "@/components/creator/creator-shell";

export function CreatorAccess({ children }: { children: ReactNode }) {
  const { user, ready, applySession } = useAuth();
  const { t } = useLocale();
  const [gateReady, setGateReady] = useState(false);
  const [isCreator, setIsCreator] = useState(false);

  const resolveAccess = useCallback(async () => {
    if (!user) {
      setIsCreator(false);
      setGateReady(true);
      return;
    }
    if (user.isCreator) {
      setIsCreator(true);
      setGateReady(true);
      return;
    }
    setGateReady(false);
    try {
      const st = await creatorStatus();
      const opened = !!st?.isCreator;
      setIsCreator(opened);
      if (opened) {
        const session = await getSession();
        await applySession({ ...(session || {}), isCreator: true });
      }
    } catch {
      setIsCreator(false);
    } finally {
      setGateReady(true);
    }
  }, [user, applySession]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      await resolveAccess();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, resolveAccess]);

  if (!ready || (user && !gateReady)) {
    return (
      <div className="mx-auto max-w-[960px] px-4 py-24 text-center text-ink-subtle">
        {t("common.loading")}
      </div>
    );
  }

  if (!user || !isCreator) {
    return (
      <CreatorGate
        onActivated={() => {
          setIsCreator(true);
          setGateReady(true);
        }}
      />
    );
  }

  return <CreatorShell>{children}</CreatorShell>;
}

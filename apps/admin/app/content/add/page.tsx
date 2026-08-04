"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { ContentImportPanel } from "@/components/content-import-panel";
import { HongguoImportPanel } from "@/components/hongguo-import-panel";
import { OnlineDramaForm } from "@/components/online-drama-form";
import { useI18n } from "@/lib/i18n";
import { Button } from "@velvet/ui";

type AddTab = "local" | "online";

function ContentAddInner() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabFromUrl = searchParams.get("tab") === "online" ? "online" : "local";
  const [tab, setTab] = useState<AddTab>(tabFromUrl);

  useEffect(() => {
    setTab(tabFromUrl);
  }, [tabFromUrl]);

  function switchTab(next: AddTab) {
    setTab(next);
    const qs = next === "online" ? "?tab=online" : "";
    router.replace(`/content/add${qs}`);
  }

  return (
    <AdminShell title={t("contentAdd")}>
      <div className="mb-4 flex gap-2">
        {(
          [
            ["local", t("contentLocal")],
            ["online", t("contentOnline")],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={tab === key ? "primary" : "secondary"}
            onClick={() => switchTab(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {tab === "local" ? (
        <div className="space-y-4">
          <p className="text-body-sm text-ink-muted">{t("contentAddLocalHint")}</p>
          <ContentImportPanel />
        </div>
      ) : (
        <div className="space-y-8">
          <HongguoImportPanel />
          <div className="border-t border-line pt-6">
            <h3 className="mb-3 text-h4 font-semibold">{t("onlineManualTitle")}</h3>
            <OnlineDramaForm />
          </div>
        </div>
      )}
    </AdminShell>
  );
}

export default function AdminContentAddPage() {
  const { t } = useI18n();
  return (
    <Suspense
      fallback={
        <AdminShell title={t("contentAdd")}>
          <p className="text-ink-muted">{t("loading")}</p>
        </AdminShell>
      }
    >
      <ContentAddInner />
    </Suspense>
  );
}

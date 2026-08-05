"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { ContentAddPanel, type ContentAddTab } from "@/components/content-add-panel";
import { useI18n } from "@/lib/i18n";

function AdminContentAddInner() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab: ContentAddTab =
    searchParams.get("tab") === "online"
      ? "online"
      : searchParams.get("tab") === "local"
        ? "local"
        : "upload";

  function setTab(next: ContentAddTab) {
    const qs =
      next === "online" ? "?tab=online" : next === "local" ? "?tab=local" : "?tab=upload";
    router.replace(`/content/add${qs}`);
  }

  return (
    <AdminShell title={t("contentAdd")}>
      <div className="admin-fill card glass-card flex min-h-0 flex-col p-4 md:p-6">
        <ContentAddPanel tab={tab} onTabChange={setTab} />
      </div>
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
      <AdminContentAddInner />
    </Suspense>
  );
}

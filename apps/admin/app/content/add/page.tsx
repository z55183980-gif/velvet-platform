"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import {
  ContentAddPanel,
  contentAddQuery,
  parseContentAddSelection,
  type ContentAddSelection,
} from "@/components/content-add-panel";
import { useI18n } from "@/lib/i18n";

function AdminContentAddInner() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selection = parseContentAddSelection({
    tab: searchParams.get("tab"),
    method: searchParams.get("method"),
  });

  function setSelection(next: ContentAddSelection) {
    router.replace(`/content/add${contentAddQuery(next)}`);
  }

  return (
    <AdminShell title={t("contentAdd")}>
      <ContentAddPanel
        tab={selection.tab}
        method={selection.method}
        onSelectionChange={setSelection}
      />
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

"use client";

import { useEffect, useState } from "react";
import { ContentImportPanel } from "@/components/content-import-panel";
import { OnlineDramaForm } from "@/components/online-drama-form";
import { UploadDramaForm } from "@/components/upload-drama-form";
import { YtdlpImportPanel } from "@/components/ytdlp-import-panel";
import { useI18n } from "@/lib/i18n";

export type ContentAddTab = "upload" | "local" | "online";

export function ContentAddPanel({
  tab: controlledTab,
  onTabChange,
}: {
  tab?: ContentAddTab;
  onTabChange?: (tab: ContentAddTab) => void;
} = {}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<ContentAddTab>(controlledTab ?? "upload");

  useEffect(() => {
    if (controlledTab) setTab(controlledTab);
  }, [controlledTab]);

  function switchTab(next: ContentAddTab) {
    setTab(next);
    onTabChange?.(next);
  }

  return (
    <div>
      <div className="mb-4" role="tablist" aria-label={t("contentAdd")}>
        <div className="seg-tabs">
          {(
            [
              ["upload", t("contentUpload")],
              ["local", t("contentLocal")],
              ["online", t("contentOnline")],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className="seg-tabs__item"
              onClick={() => switchTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "upload" ? (
        <UploadDramaForm />
      ) : tab === "local" ? (
        <div className="space-y-4">
          <p className="text-body-sm text-ink-muted">{t("contentAddLocalHint")}</p>
          <ContentImportPanel />
        </div>
      ) : (
        <div className="space-y-8">
          <YtdlpImportPanel />
          <div className="border-t border-line pt-6">
            <h3 className="mb-3 text-h4 font-semibold">{t("onlineManualTitle")}</h3>
            <OnlineDramaForm />
          </div>
        </div>
      )}
    </div>
  );
}

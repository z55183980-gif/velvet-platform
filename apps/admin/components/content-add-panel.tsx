"use client";

import { useEffect, useState } from "react";
import { LocalUploadWizard } from "@/components/local-upload-wizard";
import { OnlineDramaForm } from "@/components/online-drama-form";
import { YtdlpImportPanel } from "@/components/ytdlp-import-panel";
import { useI18n } from "@/lib/i18n";

/**
 * 本地上传：统一向导（文件 / 文件夹 / 服务器路径）。
 * 在线入库：链接直播 / 转存托管。
 */
export type ContentAddTab = "owned" | "online";
export type ContentAddMethod = "stream" | "transfer";

export type ContentAddSelection = {
  tab: ContentAddTab;
  method: ContentAddMethod;
};

function defaultOnlineMethod(method: string | null): ContentAddMethod {
  return method === "transfer" ? "transfer" : "stream";
}

export function parseContentAddSelection(params: {
  tab: string | null;
  method: string | null;
}): ContentAddSelection {
  const raw = params.tab;
  if (raw === "transfer") return { tab: "online", method: "transfer" };
  if (raw === "online") return { tab: "online", method: defaultOnlineMethod(params.method) };
  if (raw === "owned" || raw === "upload" || raw === "local") {
    return { tab: "owned", method: "stream" };
  }
  return { tab: "owned", method: "stream" };
}

export function contentAddQuery(sel: ContentAddSelection): string {
  if (sel.tab === "owned") return "?tab=owned";
  return sel.method === "transfer" ? "?tab=online&method=transfer" : "?tab=online";
}

export function ContentAddPanel({
  tab: controlledTab,
  method: controlledMethod,
  onSelectionChange,
}: {
  tab?: ContentAddTab;
  method?: ContentAddMethod;
  onSelectionChange?: (sel: ContentAddSelection) => void;
} = {}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<ContentAddTab>(controlledTab ?? "owned");
  const [method, setMethod] = useState<ContentAddMethod>(controlledMethod ?? "stream");

  useEffect(() => {
    if (controlledTab) setTab(controlledTab);
  }, [controlledTab]);

  useEffect(() => {
    if (controlledMethod) setMethod(controlledMethod);
  }, [controlledMethod]);

  function select(next: ContentAddSelection) {
    setTab(next.tab);
    setMethod(next.method);
    onSelectionChange?.(next);
  }

  return (
    <div>
      <div className="mb-4" role="tablist" aria-label={t("contentAdd")}>
        <div className="seg-tabs">
          {(
            [
              ["owned", t("contentOwned")],
              ["online", t("contentOnlineRef")],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className="seg-tabs__item"
              onClick={() =>
                select({
                  tab: key,
                  method: key === "online" ? (method === "transfer" ? "transfer" : "stream") : "stream",
                })
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "owned" ? (
        <LocalUploadWizard />
      ) : (
        <div className="space-y-4">
          <p className="text-body-sm text-ink-muted">{t("contentAddOnlineRefHint")}</p>
          <div className="seg-tabs" role="tablist" aria-label={t("contentOnlineMethods")}>
            {(
              [
                ["stream", t("contentOnlineStream")],
                ["transfer", t("contentOnlineTransfer")],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={method === key}
                className="seg-tabs__item"
                onClick={() => select({ tab: "online", method: key })}
              >
                {label}
              </button>
            ))}
          </div>

          {method === "transfer" ? (
            <YtdlpImportPanel mode="transfer" />
          ) : (
            <div className="space-y-8">
              <YtdlpImportPanel mode="import" />
              <div className="border-t border-line pt-6">
                <h3 className="mb-1 text-h4 font-semibold">{t("onlineManualTitle")}</h3>
                <p className="mb-3 text-body-sm text-ink-muted">{t("onlineManualHint")}</p>
                <OnlineDramaForm />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

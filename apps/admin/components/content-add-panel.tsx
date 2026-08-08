"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmModal, GlassModal } from "@/components/glass-modal";
import {
  LocalUploadWizard,
  type LocalUploadWizardHandle,
} from "@/components/local-upload-wizard";
import { YtdlpImportPanel, type OnlineIngestTab } from "@/components/ytdlp-import-panel";
import type { DramaInfoFillPayload } from "@/lib/drama-info-fill";
import { useI18n } from "@/lib/i18n";
import { useUnsavedNavigationGuard } from "@/lib/use-unsaved-navigation-guard";

/**
 * 本地上传：统一向导（文件 / 文件夹）。
 * 在线入库弹窗：解析/粘贴后回填主窗口；主窗口统一提交才真正入库。
 */
export type ContentAddTab = "owned" | "online";

export type ContentAddSelection = {
  tab: ContentAddTab;
};

export function parseContentAddSelection(params: {
  tab: string | null;
  /** @deprecated ignored — probe-first UI no longer splits by method */
  method?: string | null;
}): ContentAddSelection {
  const raw = params.tab;
  if (raw === "transfer" || raw === "online") return { tab: "online" };
  if (raw === "owned" || raw === "upload" || raw === "local") {
    return { tab: "owned" };
  }
  return { tab: "owned" };
}

export function contentAddQuery(sel: ContentAddSelection): string {
  return sel.tab === "online" ? "?tab=online" : "?tab=owned";
}

export function ContentAddPanel({
  tab: controlledTab,
  onSelectionChange,
}: {
  tab?: ContentAddTab;
  /** @deprecated ignored */
  method?: string;
  onSelectionChange?: (sel: ContentAddSelection) => void;
} = {}) {
  const { t } = useI18n();
  const wizardRef = useRef<LocalUploadWizardHandle>(null);
  const [tab, setTab] = useState<ContentAddTab>(controlledTab ?? "owned");
  const [onlineKey, setOnlineKey] = useState(0);
  const [onlineIngestTab, setOnlineIngestTab] = useState<OnlineIngestTab>("parse");
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);

  const markDirty = useCallback((next: boolean) => {
    dirtyRef.current = next;
    setDirty(next);
  }, []);

  const onlineOpen = tab === "online";
  const guardEnabled = onlineOpen && dirty;
  const { confirmOpen, confirmLeave, cancelLeave, requestLeave } =
    useUnsavedNavigationGuard({
      enabled: guardEnabled,
      dirtyRef,
    });

  useEffect(() => {
    if (controlledTab) setTab(controlledTab);
  }, [controlledTab]);

  function applySelection(next: ContentAddSelection) {
    setTab(next.tab);
    onSelectionChange?.(next);
  }

  function openOnline() {
    if (tab === "online") return;
    setOnlineIngestTab("parse");
    applySelection({ tab: "online" });
  }

  function closeOnline() {
    if (tab !== "online") return;

    const leave = () => {
      dirtyRef.current = false;
      setDirty(false);
      setOnlineKey((k) => k + 1);
      setOnlineIngestTab("parse");
      applySelection({ tab: "owned" });
    };

    if (dirtyRef.current) {
      requestLeave(leave);
      return;
    }
    leave();
  }

  function fillDramaInfo(payload: DramaInfoFillPayload) {
    wizardRef.current?.applyDramaInfo(payload);
    // Meta-only fill keeps the modal open so the user can still Apply episodes.
    if (!payload.online) return;
    dirtyRef.current = false;
    setDirty(false);
    setOnlineKey((k) => k + 1);
    setOnlineIngestTab("parse");
    applySelection({ tab: "owned" });
  }

  return (
    <div>
      <LocalUploadWizard ref={wizardRef} onRequestOnline={openOnline} />

      <GlassModal
        open={onlineOpen}
        onClose={closeOnline}
        title={
          <div className="seg-tabs" role="tablist" aria-label={t("contentOnlineRef")}>
            {(
              [
                ["parse", t("onlineIngestTabParse")],
                ["manual", t("onlineIngestTabManual")],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={onlineIngestTab === key}
                className="seg-tabs__item"
                onClick={() => setOnlineIngestTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
        }
        size="2xl"
      >
        <div className="space-y-3">
          {onlineOpen ? (
            <YtdlpImportPanel
              key={onlineKey}
              embedded
              ingestTab={onlineIngestTab}
              onIngestTabChange={setOnlineIngestTab}
              onDirtyChange={markDirty}
              onFillDramaInfo={fillDramaInfo}
            />
          ) : null}
        </div>
      </GlassModal>

      <ConfirmModal
        open={confirmOpen}
        onClose={cancelLeave}
        onConfirm={confirmLeave}
        title={t("unsavedChanges")}
        message={t("confirmLeaveUnsavedInput")}
        cancelLabel={t("stayEditing")}
        confirmLabel={t("leaveAnyway")}
        confirmVariant="danger"
      />
    </div>
  );
}

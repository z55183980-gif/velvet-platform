"use client";

import { AdminShell } from "@/components/admin-shell";
import { YtdlpImportPanel } from "@/components/ytdlp-import-panel";
import { useI18n } from "@/lib/i18n";

const REELSHORT_STORY_BEATS_URL =
  "https://www.reelshort.com/tags/story-beats";

export default function RsDramaSyncPage() {
  const { t } = useI18n();

  return (
    <AdminShell title={t("rsDramaSync")}>
      <YtdlpImportPanel
        initialUrl={REELSHORT_STORY_BEATS_URL}
        enableCatalogMultiSelect
        catalogCardsOpenEditor
        dedicatedCatalogMode
      />
    </AdminShell>
  );
}

"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { adminImportUpload, adminLocalImport } from "@velvet/api-client";
import { Button, Input } from "@velvet/ui";
import { useI18n } from "@/lib/i18n";

type ImportResult = {
  scanned?: number;
  imported?: number;
  skipped?: number;
  errors?: unknown[];
  items?: unknown[];
  hint?: string;
  dryRun?: boolean;
};

export function ContentImportPanel() {
  const { t } = useI18n();
  const [rootPath, setRootPath] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const uploadMut = useMutation({
    mutationFn: ({ files, dryRun }: { files: FileList; dryRun: boolean }) =>
      adminImportUpload(files, dryRun) as Promise<ImportResult>,
    onSuccess: (data) => {
      setResult(data);
      setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const localMut = useMutation({
    mutationFn: (dryRun: boolean) =>
      adminLocalImport(rootPath.trim() || undefined, dryRun) as Promise<ImportResult>,
    onSuccess: (data) => {
      setResult(data);
      setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const busy = uploadMut.isPending || localMut.isPending;

  return (
    <>
      {error ? <p className="mb-3 text-body-sm text-danger">{error}</p> : null}

      <div className="mb-6 space-y-4 card glass-card p-4">
        <h2 className="text-h4 font-semibold">{t("importFolderTitle")}</h2>
        <p className="text-body-sm text-ink-muted">{t("importFolderHint")}</p>
        <input
          type="file"
          // @ts-expect-error webkitdirectory is non-standard but widely supported
          webkitdirectory=""
          directory=""
          multiple
          disabled={busy}
          onChange={(e) => {
            const files = e.target.files;
            if (!files?.length) return;
            uploadMut.mutate({ files, dryRun: true });
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              const input = document.querySelector<HTMLInputElement>('input[type="file"]');
              if (!input?.files?.length) {
                setError(t("selectFolderFirst"));
                return;
              }
              uploadMut.mutate({ files: input.files, dryRun: true });
            }}
          >
            {t("dryRunPreview")}
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              const input = document.querySelector<HTMLInputElement>('input[type="file"]');
              if (!input?.files?.length) {
                setError(t("selectFolderFirst"));
                return;
              }
              uploadMut.mutate({ files: input.files, dryRun: false });
            }}
          >
            {t("confirmImport")}
          </Button>
        </div>
      </div>

      <div className="mb-6 space-y-4 card glass-card p-4">
        <h2 className="text-h4 font-semibold">{t("localPathTitle")}</h2>
        <p className="text-body-sm text-ink-muted">{t("localPathHint")}</p>
        <Input
          className="max-w-xl"
          placeholder={t("localPathPlaceholder")}
          value={rootPath}
          onChange={(e) => setRootPath(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => localMut.mutate(true)}>
            {t("dryRunPreview")}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => localMut.mutate(false)}>
            {t("confirmImport")}
          </Button>
        </div>
      </div>

      {result ? (
        <div className="card glass-card space-y-2 p-4 text-body-sm">
          <p>
            {t("importSummary", {
              scanned: result.scanned ?? "—",
              imported: result.imported ?? "—",
              skipped: result.skipped ?? "—",
            })}
            {result.dryRun ? " · dry-run" : ""}
          </p>
          {result.hint ? <p className="text-ink-muted">{result.hint}</p> : null}
          {Array.isArray(result.errors) && result.errors.length > 0 ? (
            <pre className="max-h-48 overflow-auto rounded-lg bg-surface-2 p-3 text-caption text-danger">
              {JSON.stringify(result.errors, null, 2)}
            </pre>
          ) : null}
          {Array.isArray(result.items) && result.items.length > 0 ? (
            <pre className="max-h-64 overflow-auto rounded-lg bg-surface-2 p-3 text-caption">
              {JSON.stringify(result.items.slice(0, 50), null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

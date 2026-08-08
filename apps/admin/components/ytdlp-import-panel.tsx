"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  adminStorageStatus,
  adminYtdlpAiExtract,
  adminYtdlpDownloadEpisode,
  adminYtdlpProbe,
  adminYtdlpResolve,
  adminYtdlpStatus,
  adminYtdlpUploadCookies,
} from "@velvet/api-client";
import { Button, Input, Select } from "@velvet/ui";
import { StreamPreview } from "@/components/stream-preview";
import { OnlineDramaForm } from "@/components/online-drama-form";
import {
  dramaInfoFromYtdlpProbe,
  type DramaInfoFillPayload,
  type OnlineIngestForm,
} from "@/lib/drama-info-fill";
import { useI18n } from "@/lib/i18n";

type ProbeResult =
  | Awaited<ReturnType<typeof adminYtdlpProbe>>
  | Awaited<ReturnType<typeof adminYtdlpAiExtract>>;
type FormatPreference = "best_hls" | "best_mp4" | "best";
type IngestTab = "parse" | "manual";

function isAiProbe(
  p: ProbeResult | null,
): p is Awaited<ReturnType<typeof adminYtdlpAiExtract>> {
  return !!p && "source" in p && p.source === "ai";
}

function episodeSourceUrl(ep: ProbeResult["episodes"][number]): string | undefined {
  return "sourceUrl" in ep && typeof ep.sourceUrl === "string"
    ? ep.sourceUrl.trim() || undefined
    : undefined;
}

function guessHostnameFromUrl(raw: string): string {
  try {
    return new URL(raw.trim()).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * 在线资源准备：公开页解析或手动粘贴直链。
 * 不在弹窗内创建剧集；把信息与片源配置回填主窗口，由主窗口统一提交。
 */
export function YtdlpImportPanel({
  onDirtyChange,
  embedded = false,
  onFillDramaInfo,
}: {
  onDirtyChange?: (dirty: boolean) => void;
  embedded?: boolean;
  onFillDramaInfo?: (payload: DramaInfoFillPayload) => void;
} = {}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [ingestTab, setIngestTab] = useState<IngestTab>("parse");
  const [ingestForm, setIngestForm] = useState<OnlineIngestForm>("r2");
  const [manualDirty, setManualDirty] = useState(false);
  const [url, setUrl] = useState("");
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [maxEpisodes, setMaxEpisodes] = useState("");
  const [formatPreference, setFormatPreference] = useState<FormatPreference>("best_hls");
  const [error, setError] = useState<string | null>(null);
  const [engineOpen, setEngineOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [cookiesFile, setCookiesFile] = useState("");
  const [authBearer, setAuthBearer] = useState("");
  const [cookieHost, setCookieHost] = useState("");
  const [cookieUploadBusy, setCookieUploadBusy] = useState(false);
  const [previewEpIndex, setPreviewEpIndex] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [filled, setFilled] = useState(false);
  const [applied, setApplied] = useState(false);
  const [overwriteMeta, setOverwriteMeta] = useState(false);
  const [downloadingEpIndex, setDownloadingEpIndex] = useState<number | null>(null);

  const statusQ = useQuery({
    queryKey: ["admin", "ytdlp", "status"],
    queryFn: () => adminYtdlpStatus(),
  });
  const storageQ = useQuery({
    queryKey: ["admin", "storage", "status"],
    queryFn: () => adminStorageStatus(),
  });

  const parseDirty = Boolean(url.trim() || probe || maxEpisodes.trim());
  const dirty = parseDirty || manualDirty;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    return () => onDirtyChange?.(false);
  }, [onDirtyChange]);

  function clearDirtyForNav() {
    setManualDirty(false);
    onDirtyChange?.(false);
  }

  function clearUrlInput() {
    setUrl("");
    setProbe(null);
    setPreviewEpIndex(null);
    setPreviewUrl(null);
    setError(null);
    setFilled(false);
    setApplied(false);
  }

  function probeMaxEpisodes() {
    const max = maxEpisodes.trim() ? Number(maxEpisodes) : undefined;
    return max && max > 0 ? max : undefined;
  }

  /** Fill title/cover/desc/count only — does not stage episode resources. */
  function fillDramaMeta() {
    if (!probe) {
      setError(t("ytdlpNeedProbe"));
      return;
    }
    if (!onFillDramaInfo) {
      setError(t("ytdlpApplyNeedMain"));
      return;
    }
    onFillDramaInfo(
      dramaInfoFromYtdlpProbe(probe, {
        maxEpisodes: probeMaxEpisodes(),
        includeMeta: true,
        includeOnline: false,
        overwriteMeta,
      }),
    );
    setFilled(true);
    setError(null);
  }

  /** Stage episode resources + ingest config — does not overwrite drama meta. */
  function applyProbeToMain() {
    if (!probe) {
      setError(t("ytdlpNeedProbe"));
      return;
    }
    if (!onFillDramaInfo) {
      setError(t("ytdlpApplyNeedMain"));
      return;
    }
    onFillDramaInfo(
      dramaInfoFromYtdlpProbe(probe, {
        pageUrl: url.trim(),
        ingestForm,
        formatPreference,
        maxEpisodes: probeMaxEpisodes(),
        includeMeta: false,
        includeOnline: true,
      }),
    );
    setApplied(true);
    clearDirtyForNav();
  }

  function authPayload() {
    const file = cookiesFile.trim() || undefined;
    const bearer = authBearer.trim() || undefined;
    if (!file && !bearer) return undefined;
    return { cookiesFile: file, authBearer: bearer };
  }

  async function downloadEpisode(ep: ProbeResult["episodes"][number]) {
    setError(null);
    setDownloadingEpIndex(ep.index);
    const title = (ep.title || `ep-${ep.index}`).trim().slice(0, 60);
    try {
      await adminYtdlpDownloadEpisode({
        url: ep.webpageUrl,
        formatPreference:
          formatPreference === "best_hls" ? "best_mp4" : formatPreference,
        playlistIndex: ep.playlistIndex,
        filenameHint: `${String(ep.index).padStart(2, "0")}-${title}`,
        ...authPayload(),
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloadingEpIndex(null);
    }
  }

  const probeMut = useMutation({
    mutationFn: () => {
      const u = url.trim();
      if (!u) throw new Error(t("ytdlpNeedUrl"));
      return adminYtdlpProbe(u, authPayload());
    },
    onSuccess: (data) => {
      setError(null);
      setPreviewEpIndex(null);
      setPreviewUrl(null);
      setFilled(false);
      setApplied(false);
      setProbe(data);
    },
    onError: (e: Error) => {
      setProbe(null);
      setFilled(false);
      setApplied(false);
      setError(e.message);
    },
  });

  const aiExtractMut = useMutation({
    mutationFn: () => {
      const u = url.trim();
      if (!u) throw new Error(t("ytdlpNeedUrl"));
      if (!statusQ.data?.openaiConfigured) {
        throw new Error(t("ytdlpAiExtractNeedOpenai"));
      }
      return adminYtdlpAiExtract(u, {
        maxEpisodes: probeMaxEpisodes(),
        ...authPayload(),
      });
    },
    onSuccess: (data) => {
      setError(null);
      setPreviewEpIndex(null);
      setPreviewUrl(null);
      setFilled(false);
      setApplied(false);
      setIngestForm("link");
      setProbe(data);
    },
    onError: (e: Error) => {
      setFilled(false);
      setApplied(false);
      setError(e.message);
    },
  });

  const resolveMut = useMutation({
    mutationFn: async (ep: ProbeResult["episodes"][number]) => {
      const direct = episodeSourceUrl(ep);
      if (direct && /\.(m3u8|mp4|webm|mkv)(\?|$)/i.test(direct)) {
        return { playUrl: direct, originalUrl: direct };
      }
      return adminYtdlpResolve({
        url: ep.webpageUrl,
        formatPreference,
        playlistIndex: ep.playlistIndex,
        ...authPayload(),
      });
    },
    onSuccess: (data, ep) => {
      setError(null);
      setPreviewEpIndex(ep.index);
      setPreviewUrl(data.playUrl);
    },
    onError: (e: Error) => setError(e.message),
  });

  async function onCookieFilePicked(file: File | null) {
    if (!file) return;
    const host =
      cookieHost.trim() ||
      guessHostnameFromUrl(url) ||
      file.name.replace(/\.txt$/i, "").trim();
    if (!host) {
      setError(t("ytdlpAuthNeedHostname"));
      return;
    }
    setCookieUploadBusy(true);
    setError(null);
    try {
      const saved = await adminYtdlpUploadCookies(file, host);
      setCookiesFile(saved.filename);
      setCookieHost(host.replace(/^www\./, ""));
      setAuthOpen(true);
      await qc.invalidateQueries({ queryKey: ["admin", "ytdlp", "status"] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCookieUploadBusy(false);
    }
  }

  const configured = !!statusQ.data?.configured;
  const openaiReady = !!statusQ.data?.openaiConfigured;
  const authInfo = statusQ.data?.auth;
  const hostCookieFiles = authInfo?.hostCookieFiles ?? [];
  const authReady =
    !!cookiesFile.trim() ||
    !!authBearer.trim() ||
    !!authInfo?.globalCookiesConfigured ||
    !!authInfo?.bearerConfigured ||
    hostCookieFiles.length > 0;
  const r2Ready = !!storageQ.data?.r2Configured;
  const ffmpegReady = storageQ.data?.ffmpegReady !== false;
  const busy =
    probeMut.isPending ||
    aiExtractMut.isPending ||
    resolveMut.isPending ||
    downloadingEpIndex != null ||
    cookieUploadBusy;
  const activePreviewSrc = previewUrl;
  const showEmpty = !probe && !error && !probeMut.isPending;

  const panelClass = embedded
    ? "space-y-3"
    : "upload-panel upload-panel--primary space-y-3";
  const PanelTag = embedded ? "div" : "section";

  return (
    <div className="space-y-4">
      <PanelTag className={panelClass}>
        <div className="upload-panel__head upload-panel__head--flush">
          <div className="min-w-0">
            <h3>{t("ytdlpUnifiedTitle")}</h3>
            <p>
              {ingestTab === "parse" ? t("ytdlpUnifiedHint") : t("onlineManualHint")}
            </p>
          </div>
          {ingestTab === "parse" && configured ? (
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line/60 bg-white px-2.5 py-1 text-caption text-ink-muted hover:bg-surface-2"
              onClick={() => setEngineOpen((v) => !v)}
              aria-expanded={engineOpen}
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--color-success)" }}
                aria-hidden
              />
              {t("ytdlpEngineReady")}
              <span className="text-ink-subtle" aria-hidden>
                {engineOpen ? "▾" : "▸"}
              </span>
            </button>
          ) : null}
        </div>

        <div className="seg-tabs" role="tablist" aria-label={t("ytdlpUnifiedTitle")}>
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
              aria-selected={ingestTab === key}
              className="seg-tabs__item"
              onClick={() => setIngestTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {ingestTab === "manual" ? (
          <OnlineDramaForm
            embedded
            fillMode
            onDirtyChange={setManualDirty}
            onFillDramaInfo={(payload) => {
              onFillDramaInfo?.(payload);
              clearDirtyForNav();
            }}
          />
        ) : (
          <>
            {!configured ? (
              <p className="text-body-sm text-danger">
                {t("ytdlpNotConfigured")}
                {statusQ.data?.lastError ? ` (${statusQ.data.lastError})` : ""}
              </p>
            ) : engineOpen ? (
              <p className="break-all text-caption text-ink-muted">
                {t("ytdlpProvider")}: {statusQ.data?.provider}
                {statusQ.data?.version ? ` ${statusQ.data.version}` : ""}
                {statusQ.data?.binSource
                  ? ` · ${t("ytdlpBinSource")}: ${statusQ.data.binSource}`
                  : ""}
                {statusQ.data?.bin ? ` · ${statusQ.data.bin}` : ""}
                {" · "}
                {t("ytdlpNoApiKey")}
              </p>
            ) : null}

            <div className="rounded-lg border border-line/70 bg-surface-2/40 px-3 py-2.5 space-y-2">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 text-left"
                onClick={() => setAuthOpen((v) => !v)}
                aria-expanded={authOpen}
              >
                <span className="inline-flex items-center gap-2 text-body-sm font-medium text-ink">
                  {t("ytdlpAuthTitle")}
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{
                      background: authReady
                        ? "var(--color-success)"
                        : "var(--color-ink-subtle)",
                    }}
                    aria-hidden
                  />
                  <span className="text-caption font-normal text-ink-muted">
                    {authReady ? t("ytdlpAuthReady") : t("ytdlpAuthOptional")}
                  </span>
                </span>
                <span className="text-ink-subtle" aria-hidden>
                  {authOpen ? "▾" : "▸"}
                </span>
              </button>
              {!authOpen ? (
                <p className="text-caption text-ink-muted">{t("ytdlpAuthHint")}</p>
              ) : (
                <div className="space-y-3 border-t border-line/50 pt-2.5">
                  <p className="text-caption text-ink-muted">{t("ytdlpAuthHint")}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="space-y-1 text-caption text-ink-muted">
                      <span>{t("ytdlpAuthCookiesSelect")}</span>
                      <Select
                        value={cookiesFile}
                        disabled={!configured || busy}
                        onChange={(e) => setCookiesFile(e.target.value)}
                      >
                        <option value="">{t("ytdlpAuthCookiesAuto")}</option>
                        {hostCookieFiles.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                        {cookiesFile && !hostCookieFiles.includes(cookiesFile) ? (
                          <option value={cookiesFile}>{cookiesFile}</option>
                        ) : null}
                      </Select>
                    </label>
                    <label className="space-y-1 text-caption text-ink-muted">
                      <span>{t("ytdlpAuthBearer")}</span>
                      <Input
                        type="password"
                        autoComplete="off"
                        placeholder="Bearer token"
                        value={authBearer}
                        disabled={!configured || busy}
                        onChange={(e) => setAuthBearer(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="min-w-[10rem] flex-1 space-y-1 text-caption text-ink-muted">
                      <span>{t("ytdlpAuthHostname")}</span>
                      <Input
                        placeholder="reelshort.com"
                        value={cookieHost}
                        disabled={!configured || busy}
                        onChange={(e) => setCookieHost(e.target.value)}
                        onFocus={() => {
                          if (!cookieHost.trim() && url.trim()) {
                            setCookieHost(guessHostnameFromUrl(url));
                          }
                        }}
                      />
                    </label>
                    <label className="inline-flex cursor-pointer items-center">
                      <input
                        type="file"
                        accept=".txt,text/plain"
                        className="hidden"
                        disabled={!configured || busy}
                        onChange={(e) => {
                          const f = e.target.files?.[0] || null;
                          void onCookieFilePicked(f);
                          e.target.value = "";
                        }}
                      />
                      <span className="inline-flex h-9 items-center rounded-md border border-line bg-white px-3 text-body-sm text-ink hover:bg-surface-2">
                        {cookieUploadBusy
                          ? t("ytdlpAuthUploading")
                          : t("ytdlpAuthUpload")}
                      </span>
                    </label>
                  </div>
                  {authInfo ? (
                    <p className="break-all text-caption text-ink-subtle">
                      {t("ytdlpAuthStatusLine", {
                        cookies: authInfo.globalCookiesConfigured
                          ? t("ytdlpAuthYes")
                          : t("ytdlpAuthNo"),
                        bearer: authInfo.bearerConfigured
                          ? t("ytdlpAuthYes")
                          : t("ytdlpAuthNo"),
                        files: String(hostCookieFiles.length),
                      })}
                    </p>
                  ) : null}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <Input
                className="min-w-[20rem] flex-1"
                placeholder={t("ytdlpUrlPlaceholder")}
                value={url}
                disabled={!configured}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setProbe(null);
                  setPreviewEpIndex(null);
                  setPreviewUrl(null);
                  setFilled(false);
                  setApplied(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && configured && url.trim()) {
                    probeMut.mutate();
                  }
                }}
              />
              <Button
                size="sm"
                variant={probe && !isAiProbe(probe) ? "secondary" : "primary"}
                className={
                  probe && !isAiProbe(probe)
                    ? "border-success/40 bg-success-soft text-success hover:bg-success/15"
                    : undefined
                }
                disabled={!configured || !url.trim() || busy}
                onClick={() => probeMut.mutate()}
              >
                {probeMut.isPending
                  ? t("loading")
                  : probe && !isAiProbe(probe)
                    ? t("ytdlpProbeDone")
                    : t("ytdlpProbe")}
              </Button>
              <Button
                size="sm"
                variant={isAiProbe(probe) ? "secondary" : "ghost"}
                className={
                  isAiProbe(probe)
                    ? "border-success/40 bg-success-soft text-success hover:bg-success/15"
                    : undefined
                }
                disabled={!url.trim() || busy || !openaiReady}
                title={
                  !openaiReady
                    ? t("ytdlpAiExtractNeedOpenai")
                    : t("ytdlpAiExtractHint")
                }
                onClick={() => aiExtractMut.mutate()}
              >
                {aiExtractMut.isPending
                  ? t("ytdlpAiExtractBusy")
                  : isAiProbe(probe)
                    ? t("ytdlpAiExtractDone")
                    : t("ytdlpAiExtract")}
              </Button>
              {url || probe ? (
                <Button size="sm" variant="ghost" onClick={clearUrlInput}>
                  {t("ytdlpClearUrl")}
                </Button>
              ) : null}
            </div>

            {showEmpty ? (
              <div className="online-empty">
                <p className="online-empty__title">{t("onlineEmptyTitle")}</p>
                <div className="online-empty__steps">
                  {(
                    [
                      ["1", t("onlineEmptyStep1"), t("onlineEmptyStep1Hint")],
                      ["2", t("onlineEmptyStep2"), t("onlineEmptyStep2Hint")],
                      ["3", t("onlineEmptyStep3"), t("onlineEmptyStep3Hint")],
                    ] as const
                  ).map(([n, title, hint]) => (
                    <div key={n} className="online-empty__step">
                      <span className="online-empty__n" aria-hidden>
                        {n}
                      </span>
                      <div>
                        <p>{title}</p>
                        <span>{hint}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </PanelTag>

      {ingestTab === "parse" && error ? (
        <p className="text-body-sm text-danger">{error}</p>
      ) : null}

      {ingestTab === "parse" && probe ? (
        <div className="upload-panel space-y-4">
          <div className="flex flex-wrap gap-3">
            {probe.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={probe.coverUrl} alt="" className="h-24 w-16 rounded object-cover" />
            ) : null}
            <div className="min-w-0 flex-1">
              <h4 className="font-semibold">{probe.title}</h4>
              <p className="text-caption text-ink-muted">
                {isAiProbe(probe)
                  ? `${t("ytdlpAiExtract")} · ${probe.model || "openai"}`
                  : `${probe.extractor} · ${probe.kind}`}{" "}
                · {t("importEpisodeCount", { n: probe.episodes.length })}
              </p>
              {isAiProbe(probe) && probe.notes ? (
                <p className="mt-1 text-caption text-ink-subtle">
                  {t("ytdlpAiNotes")}: {probe.notes}
                </p>
              ) : null}
              {probe.description ? (
                <p className="mt-1 line-clamp-3 text-body-sm text-ink-muted">{probe.description}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <h5 className="text-body-sm font-medium">{t("ytdlpEpisodeList")}</h5>
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded border border-line/60 p-2">
              {probe.episodes.map((ep) => (
                <li
                  key={`${ep.id}-${ep.index}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded px-2 py-1.5 text-body-sm hover:bg-surface-2"
                >
                  <span className="min-w-0 truncate">
                    <span className="text-ink-muted">#{ep.index}</span> {ep.title}
                    {ep.durationSec ? (
                      <span className="ml-2 text-caption text-ink-muted">
                        {Math.floor(ep.durationSec / 60)}:
                        {String(ep.durationSec % 60).padStart(2, "0")}
                      </span>
                    ) : null}
                  </span>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => resolveMut.mutate(ep)}
                    >
                      {resolveMut.isPending && previewEpIndex === ep.index
                        ? t("loading")
                        : t("ytdlpPreviewEp")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || !ffmpegReady}
                      title={!ffmpegReady ? t("ytdlpNeedFfmpeg") : t("ytdlpBrowserDownloadHint")}
                      onClick={() => void downloadEpisode(ep)}
                    >
                      {downloadingEpIndex === ep.index
                        ? t("ytdlpBrowserDownloading")
                        : t("ytdlpDownloadLocal")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {activePreviewSrc ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h5 className="text-body-sm font-medium">
                  {t("ytdlpPreviewTitle")}
                  {previewEpIndex != null ? ` · #${previewEpIndex}` : ""}
                </h5>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPreviewUrl(null);
                    setPreviewEpIndex(null);
                  }}
                >
                  {t("close")}
                </Button>
              </div>
              <p className="text-caption text-ink-muted">{t("ytdlpPreviewCorsHint")}</p>
              <StreamPreview
                src={activePreviewSrc}
                poster={probe.coverUrl}
                failHint={t("ytdlpPreviewCorsFail")}
              />
            </div>
          ) : null}

          <div className="flex flex-wrap items-end gap-2">
            <label className="text-caption text-ink-muted">
              {t("ytdlpFormat")}
              <Select
                className="mt-1 w-40"
                value={formatPreference}
                disabled={busy}
                onChange={(e) => {
                  setFormatPreference(e.target.value as FormatPreference);
                  setFilled(false);
                  setApplied(false);
                }}
              >
                <option value="best_hls">{t("ytdlpFormatHls")}</option>
                <option value="best_mp4">{t("ytdlpFormatMp4")}</option>
                <option value="best">{t("ytdlpFormatBest")}</option>
              </Select>
            </label>
            <label className="text-caption text-ink-muted">
              {t("importMaxEpisodes")}
              <Input
                className="mt-1 w-28"
                type="number"
                placeholder={t("all")}
                value={maxEpisodes}
                disabled={busy}
                onChange={(e) => {
                  setMaxEpisodes(e.target.value);
                  setFilled(false);
                  setApplied(false);
                }}
              />
            </label>
          </div>

          <div className="space-y-3 border-t border-line/50 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h5 className="text-body-sm font-medium">{t("ytdlpChooseIngest")}</h5>
              <div className="seg-tabs" role="tablist" aria-label={t("ytdlpChooseIngest")}>
                {(
                  [
                    ["r2", t("ytdlpIngestFormR2")],
                    ["link", t("ytdlpIngestFormLink")],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={ingestForm === key}
                    className="seg-tabs__item"
                    disabled={busy}
                    onClick={() => {
                      setIngestForm(key);
                      setFilled(false);
                      setApplied(false);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded border border-line/70 bg-surface-2/30 p-3 space-y-3">
              <p className="text-caption text-ink-muted">
                {ingestForm === "r2"
                  ? t("ytdlpIngestFormR2Hint")
                  : t("ytdlpIngestFormLinkHint")}
              </p>
              {isAiProbe(probe) && ingestForm === "r2" ? (
                <p className="text-caption text-amber-700">{t("ytdlpAiPreferLinkHint")}</p>
              ) : null}
              {ingestForm === "r2" && (!r2Ready || !ffmpegReady) ? (
                <p className="text-caption text-warning">
                  {!r2Ready ? t("ytdlpNeedR2") : t("ytdlpNeedFfmpeg")}
                </p>
              ) : null}
              <p className="text-caption text-ink-muted">{t("ytdlpApplyConfigHint")}</p>
            </div>

            {onFillDramaInfo ? (
              <div className="space-y-2 rounded-lg border border-brand/25 bg-brand/5 px-3 py-2.5">
                <label className="flex items-start gap-2 text-caption text-ink-muted">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={overwriteMeta}
                    disabled={busy}
                    onChange={(e) => setOverwriteMeta(e.target.checked)}
                  />
                  <span>{t("ytdlpOverwriteMeta")}</span>
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-body-sm font-medium text-ink">
                      {filled ? t("ytdlpFillDramaInfoDoneBtn") : t("ytdlpFillDramaInfo")}
                    </p>
                    <p className="text-caption text-ink-muted">{t("ytdlpFillDramaInfoHint")}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    className={
                      filled
                        ? "border-success/40 bg-success-soft text-success hover:bg-success/15"
                        : undefined
                    }
                    disabled={busy}
                    onClick={fillDramaMeta}
                  >
                    {filled ? t("ytdlpFillDramaInfoDoneBtn") : t("ytdlpFillDramaInfo")}
                  </Button>
                </div>
                <div
                  className={
                    applied
                      ? "flex flex-wrap items-center gap-2 rounded-md border border-success/35 bg-success-soft px-2.5 py-2"
                      : "flex flex-wrap items-center gap-2"
                  }
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-body-sm font-medium text-ink">
                      {applied ? t("ytdlpApplyToMainDone") : t("ytdlpApplyToMain")}
                    </p>
                    <p className="text-caption text-ink-muted">{t("ytdlpApplyToMainHint")}</p>
                  </div>
                  <Button
                    size="sm"
                    variant={applied ? "secondary" : "primary"}
                    className={
                      applied
                        ? "border-success/40 bg-success-soft text-success hover:bg-success/15"
                        : undefined
                    }
                    disabled={busy || (ingestForm === "r2" && (!r2Ready || !ffmpegReady))}
                    onClick={applyProbeToMain}
                  >
                    {applied ? t("ytdlpApplyToMainDone") : t("ytdlpApplyToMain")}
                  </Button>
                </div>
              </div>
            ) : null}

            <p className="text-caption text-ink-muted">{t("ytdlpImportComplianceHint")}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

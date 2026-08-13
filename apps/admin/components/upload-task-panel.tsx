"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  LoaderCircle,
  Maximize2,
  Minimize2,
  RefreshCw,
  RotateCcw,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { Button, cn } from "@velvet/ui";
import { contentDetailHref } from "@/lib/content-href";
import { useI18n } from "@/lib/i18n";
import {
  useUploadQueue,
  type UploadEpStatus,
  type UploadJob,
  type UploadJobStatus,
} from "@/lib/upload-queue";

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function jobStatusTone(status: UploadJobStatus) {
  switch (status) {
    case "completed":
      return "is-ok";
    case "failed":
      return "is-error";
    case "cancelled":
      return "is-muted";
    case "running":
    case "queued":
      return "is-loading";
    default:
      return "is-muted";
  }
}

function epStatusTone(status: UploadEpStatus) {
  switch (status) {
    case "done":
      return "is-ok";
    case "error":
      return "is-error";
    case "uploading":
      return "is-loading";
    case "cancelled":
      return "is-muted";
    default:
      return "is-muted";
  }
}

function jobInProgress(job: UploadJob) {
  if (job.publishStatus === "waiting" || job.publishStatus === "publishing") return true;
  return job.status === "queued" || job.status === "running";
}

function progressPercent(done: number, total: number) {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

function ProgressBar({ value, tone = "brand" }: { value: number; tone?: "brand" | "ok" }) {
  return (
    <span className="upload-task-progress__track" aria-hidden>
      <span
        className={cn("upload-task-progress__fill", tone === "ok" && "is-ok")}
        style={{ width: `${value}%` }}
      />
    </span>
  );
}

function JobCard({ job, fullscreen = false }: { job: UploadJob; fullscreen?: boolean }) {
  const { t } = useI18n();
  const { cancelJob, dismissTransferJob, retryFailed, retryEpisode } = useUploadQueue();
  const isTransfer = job.kind === "ytdlp-transfer";
  const done = job.episodes.filter((ep) => ep.status === "done").length;
  const total = job.episodes.length;
  const failedEpisodes = job.episodes.filter((ep) => ep.status === "error");
  const failed = failedEpisodes.length;
  const inProgress = jobInProgress(job);
  const canDismissTransfer =
    isTransfer &&
    (job.status === "completed" || job.status === "failed" || job.status === "cancelled");
  const canRetry =
    !isTransfer && job.episodes.some((ep) => ep.status === "error" || ep.status === "cancelled");
  /** null = follow default (expand only while in progress). */
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const expanded = userExpanded ?? (inProgress || fullscreen);
  const downloadTotal = job.transferProgress?.total ?? total;
  const downloadDone = job.transferProgress?.transferred ?? done;
  const downloadFailed = job.transferProgress?.failed ?? failed;
  const transcodeSettled = job.transcodeProgress
    ? job.transcodeProgress.completed + job.transcodeProgress.failed
    : done + failed;
  const transcodeTotal = job.transcodeProgress?.total ?? total;
  const downloadProcessed = downloadDone + downloadFailed;
  const downloadPercent = progressPercent(downloadProcessed, downloadTotal);
  const transcodePercent = progressPercent(transcodeSettled, transcodeTotal);

  const statusLabel =
    !job.dramaId && (job.status === "queued" || job.status === "running")
      ? t("uploadTaskCreating")
      : job.publishStatus === "waiting" || job.publishStatus === "publishing"
      ? job.publishStatus === "waiting"
        ? t("uploadTaskPublishWaiting")
        : t("uploadTaskPublishPublishing")
      : job.status === "queued"
        ? t("uploadTaskQueued")
        : job.status === "running"
          ? isTransfer
            ? job.transferPhase === "transcoding"
              ? t("uploadTaskTranscodeProgress")
              : t("ytdlpTransferProgress")
            : t("uploadTaskRunning")
          : job.status === "completed"
            ? job.publishStatus === "published"
              ? t("uploadTaskPublishPublished")
              : job.publishStatus === "failed"
                ? t("uploadTaskPublishFailed")
                : t("uploadTaskCompleted")
            : job.status === "failed"
              ? isTransfer
                ? t("ytdlpTransferFailed")
                : t("uploadTaskFailed")
              : t("uploadTaskCancelled");

  const statusTone =
    job.publishStatus === "published"
      ? "is-ok"
      : job.publishStatus === "failed"
        ? "is-error"
        : job.publishStatus === "waiting" || job.publishStatus === "publishing"
          ? "is-loading"
          : jobStatusTone(job.status);

  return (
    <article
      className={cn(
        "upload-task-card",
        expanded && "is-expanded",
        fullscreen && "is-fullscreen-view",
      )}
    >
      <div className="upload-task-card__head">
        <button
          type="button"
          className="upload-task-card__toggle"
          onClick={() => setUserExpanded(!expanded)}
          aria-expanded={expanded}
        >
          <span className="upload-task-card__chevron" aria-hidden>
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate font-medium text-ink">{job.title}</p>
            <p className="mt-0.5 text-caption text-ink-muted">
              {isTransfer
                ? t("uploadTaskModeTransfer")
                : job.mode === "append"
                  ? t("uploadTaskModeAppend")
                  : t("uploadTaskModeNew")}
              {job.publishWhenReady ? ` · ${t("uploadTaskWillPublish")}` : ""}
              {" · "}
              {t("uploadProgressLabel", { done, total })}
              {isTransfer && job.transcodeProgress?.total
                ? ` · ${t("uploadTaskTranscodeSummary", {
                    done: String(job.transcodeProgress.completed),
                    total: String(job.transcodeProgress.total),
                    queued: String(
                      job.transcodeProgress.pending + job.transcodeProgress.queued,
                    ),
                    processing: String(job.transcodeProgress.processing),
                  })}`
                : ""}
              {failed ? ` · ${t("uploadTaskFailedCount", { n: failed })}` : ""}
            </p>
          </div>
          <span className={cn("upload-status-pill", statusTone)}>{statusLabel}</span>
        </button>
        {inProgress ? (
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0"
            onClick={() => cancelJob(job.id)}
            title={isTransfer ? t("uploadTaskStopTracking") : t("uploadTaskCancel")}
            aria-label={isTransfer ? t("uploadTaskStopTracking") : t("uploadTaskCancel")}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        {canDismissTransfer ? (
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 text-ink-muted hover:text-ink"
            disabled={dismissing}
            onClick={async (e) => {
              e.stopPropagation();
              setDismissing(true);
              try {
                await dismissTransferJob(job.id);
              } catch {
                // Keep the card visible when the server refuses the clear.
              } finally {
                setDismissing(false);
              }
            }}
            title={t("uploadTaskDismiss")}
            aria-label={t("uploadTaskDismiss")}
          >
            {dismissing ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <X className="h-3.5 w-3.5" />
            )}
          </Button>
        ) : null}
      </div>

      {expanded ? (
        <>
          <div className="upload-task-progress-grid">
            <div className="upload-task-progress">
              <div className="upload-task-progress__label">
                <span>{isTransfer ? t("uploadTaskDownloadStage") : t("uploadTaskUploadStage")}</span>
                <strong>
                  {downloadProcessed}/{downloadTotal} · {downloadPercent}%
                </strong>
              </div>
              <ProgressBar value={downloadPercent} />
              <p>
                {job.transferProgress?.currentEpisode
                  ? t("uploadTaskCurrentEpisode", { n: job.transferProgress.currentEpisode })
                  : job.status === "queued"
                    ? t("uploadTaskWaitingSerialQueue")
                    : downloadFailed > 0
                      ? t("uploadTaskFailedCount", { n: downloadFailed })
                      : t("uploadTaskStageSettled")}
              </p>
            </div>
            {isTransfer ? (
              <div className="upload-task-progress">
                <div className="upload-task-progress__label">
                  <span>{t("uploadTaskTranscodeStage")}</span>
                  <strong>
                    {transcodeSettled}/{transcodeTotal} · {transcodePercent}%
                  </strong>
                </div>
                <ProgressBar value={transcodePercent} tone="ok" />
                <p>
                  {job.transcodeProgress
                    ? t("uploadTaskTranscodeDetail", {
                        pending: job.transcodeProgress.pending + job.transcodeProgress.queued,
                        processing: job.transcodeProgress.processing,
                        failed: job.transcodeProgress.failed,
                      })
                    : t("uploadTaskTranscodePendingDetail")}
                </p>
              </div>
            ) : null}
          </div>

          {job.error ? <p className="content-inline-error mt-2 text-caption">{job.error}</p> : null}
          {job.publishError && job.publishStatus === "failed" ? (
            <p className="content-inline-error mt-2 text-caption">
              {job.publishError === "publish-timeout"
                ? t("uploadTaskPublishTimeout")
                : job.publishError.startsWith("transcode-failed")
                  ? t("uploadTaskPublishFailed")
                  : job.publishError}
            </p>
          ) : null}

          {isTransfer && failedEpisodes.length > 0 ? (
            <section className="upload-task-failures" aria-label={t("uploadTaskManualListTitle")}>
              <div className="upload-task-failures__head">
                <strong>{t("uploadTaskManualListTitle")}</strong>
                <span>{t("uploadTaskManualListCount", { n: failedEpisodes.length })}</span>
              </div>
              <ul className="scrollbar-thin">
                {failedEpisodes.map((ep) => (
                  <li key={`failure-${ep.id}`}>
                    <span className="upload-task-failures__episode">
                      {t("localWizardEpisodeNumLabel", { n: ep.episodeNumber })}
                    </span>
                    <span className="upload-task-failures__stage">
                      {ep.failureStage === "download"
                        ? t("uploadTaskFailureDownload")
                        : ep.failureStage === "drama_skipped"
                          ? t("uploadTaskFailureDramaSkipped")
                        : ep.failureStage === "stalled"
                          ? t("uploadTaskFailureStalled")
                          : t("uploadTaskFailureTranscode")}
                      {ep.failureAttempts
                        ? ` · ${t("uploadTaskFailureAttempts", { n: ep.failureAttempts })}`
                        : ""}
                    </span>
                    <span className="upload-task-failures__reason">
                      {ep.error || t("uploadTaskFailureUnknown")}
                    </span>
                  </li>
                ))}
              </ul>
              <p>{t("uploadTaskManualListHint")}</p>
            </section>
          ) : null}

          <ul className="upload-task-card__eps scrollbar-thin">
            {job.episodes.map((ep) => (
              <li key={ep.id} className="upload-task-ep">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body-sm text-ink">
                    {t("localWizardEpisodeNumLabel", { n: ep.episodeNumber })}
                    {" · "}
                    {ep.title || ep.fileName}
                  </p>
                  <p className="truncate text-caption text-ink-subtle">
                    {isTransfer
                      ? t("uploadTaskTransferEpHint")
                      : `${ep.fileName} · ${fmtSize(ep.fileSize)}`}
                    {ep.error ? ` · ${ep.error}` : ""}
                  </p>
                </div>
                <span className={cn("upload-status-pill shrink-0", epStatusTone(ep.status))}>
                  {ep.status === "uploading" ? <LoaderCircle className="h-3 w-3 animate-spin" /> : null}
                  {ep.status === "done" ? <Check className="h-3 w-3" /> : null}
                  {ep.status === "error" ? <XCircle className="h-3 w-3" /> : null}
                  {ep.status === "pending"
                    ? t("uploadTaskEpPending")
                      : ep.status === "uploading"
                      ? isTransfer
                        ? ep.transferStage === "transcoding"
                          ? t("uploadTaskEpTranscoding")
                          : ep.transferStage === "transcode-queued"
                            ? t("uploadTaskEpTranscodeQueued")
                            : t("uploadTaskEpTransferring")
                        : t("uploadTaskEpUploading")
                      : ep.status === "done"
                        ? t("uploadTaskEpDone")
                        : ep.status === "error"
                          ? t("uploadTaskEpError")
                          : t("uploadTaskEpCancelled")}
                </span>
                {!isTransfer && (ep.status === "error" || ep.status === "cancelled") ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      retryEpisode(job.id, ep.id);
                    }}
                    title={t("uploadTaskRetryEp")}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>

          <div className="upload-task-card__actions">
            {job.dramaId ? (
              <Link
                href={contentDetailHref(job.dramaId, "episodes")}
                className="text-caption font-medium text-brand hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {t("uploadTaskOpenDrama")}
              </Link>
            ) : (
              <span className="text-caption text-ink-subtle">{t("uploadTaskCreating")}</span>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-1">
              {canRetry ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    retryFailed(job.id);
                  }}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t("uploadTaskRetryFailed")}
                </Button>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </article>
  );
}

export function UploadTaskPanel() {
  const { t } = useI18n();
  const {
    jobs,
    panelOpen,
    setPanelOpen,
    activeCount,
    browserActiveCount,
    clearFinished,
    refreshServerTransferJobs,
  } =
    useUploadQueue();
  const hasJobs = jobs.length > 0;
  const [fullscreen, setFullscreen] = useState(false);
  const [refreshingServer, setRefreshingServer] = useState(false);

  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [fullscreen]);

  if (!hasJobs && !panelOpen) return null;

  const collapseToFab = () => {
    setFullscreen(false);
    setPanelOpen(false);
  };
  const closePanel = () => {
    // Drop settled records only; in-flight jobs keep running and show as FAB.
    clearFinished();
    setFullscreen(false);
    setPanelOpen(false);
  };

  const restoreServerJobs = async () => {
    if (refreshingServer) return;
    setRefreshingServer(true);
    try {
      await refreshServerTransferJobs();
    } finally {
      setRefreshingServer(false);
    }
  };

  return (
    <div className={cn("upload-task-dock", fullscreen && "is-fullscreen")}>
      {!panelOpen ? (
        <button
          type="button"
          className="upload-task-fab"
          onClick={() => setPanelOpen(true)}
          aria-label={t("uploadTaskPanelTitle")}
        >
          {activeCount > 0 ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          <span>{t("uploadTaskFab", { n: activeCount || jobs.length })}</span>
          {activeCount > 0 ? <span className="upload-task-fab__badge">{activeCount}</span> : null}
        </button>
      ) : (
        <section
          className={cn("upload-task-panel", fullscreen && "is-fullscreen")}
          aria-label={t("uploadTaskPanelTitle")}
          aria-modal={fullscreen || undefined}
          role={fullscreen ? "dialog" : undefined}
        >
          <header className="upload-task-panel__head">
            <div>
              <h2>{t("uploadTaskPanelTitle")}</h2>
              <p>{t("uploadTaskPanelHint")}</p>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-lg text-ink-muted hover:bg-white/60 hover:text-ink disabled:opacity-50"
                onClick={() => void restoreServerJobs()}
                disabled={refreshingServer}
                aria-label={t("uploadTaskRefreshServer")}
                title={t("uploadTaskRefreshServer")}
              >
                <RefreshCw className={cn("h-4 w-4", refreshingServer && "animate-spin")} />
              </button>
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-lg text-ink-muted hover:bg-white/60 hover:text-ink"
                onClick={() => setFullscreen((value) => !value)}
                aria-label={
                  fullscreen ? t("uploadTaskExitFullscreen") : t("uploadTaskFullscreen")
                }
                title={
                  fullscreen ? t("uploadTaskExitFullscreen") : t("uploadTaskFullscreen")
                }
              >
                {fullscreen ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
              </button>
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-lg text-ink-muted hover:bg-white/60 hover:text-ink"
                onClick={collapseToFab}
                aria-label={t("uploadTaskCollapse")}
                title={t("uploadTaskCollapse")}
              >
                <ChevronDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="upload-task-clear-btn"
                onClick={closePanel}
                aria-label={t("uploadTaskClearFinished")}
                title={t("uploadTaskClearFinished")}
              >
                <X className="h-3 w-3" strokeWidth={2.5} />
              </button>
            </div>
          </header>

          {!jobs.length ? (
            <p className="px-3 py-8 text-center text-body-sm text-ink-muted">{t("uploadTaskEmpty")}</p>
          ) : (
            <div className="upload-task-panel__list scrollbar-thin">
              {jobs.map((job) => (
                <JobCard key={job.id} job={job} fullscreen={fullscreen} />
              ))}
            </div>
          )}

          {activeCount > 0 ? (
            <footer className="upload-task-panel__foot">
              <ChevronUp className="h-3.5 w-3.5 text-ink-subtle" />
              {browserActiveCount > 0
                ? t("uploadTaskKeepTabHint")
                : t("ytdlpTransferAsyncHint")}
            </footer>
          ) : null}
        </section>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  LoaderCircle,
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

function JobCard({ job }: { job: UploadJob }) {
  const { t } = useI18n();
  const { cancelJob, retryFailed, retryEpisode } = useUploadQueue();
  const isTransfer = job.kind === "ytdlp-transfer";
  const done = job.episodes.filter((ep) => ep.status === "done").length;
  const total = job.episodes.length;
  const failed = job.episodes.filter((ep) => ep.status === "error").length;
  const inProgress = jobInProgress(job);
  const canRetry =
    !isTransfer && job.episodes.some((ep) => ep.status === "error" || ep.status === "cancelled");
  /** null = follow default (expand only while in progress). */
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const expanded = userExpanded ?? inProgress;

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
            ? t("ytdlpTransferProgress")
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
    <article className={cn("upload-task-card", expanded && "is-expanded")}>
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
      </div>

      {expanded ? (
        <>
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
                        ? t("uploadTaskEpTransferring")
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
  const { jobs, panelOpen, setPanelOpen, activeCount, browserActiveCount, clearFinished } =
    useUploadQueue();
  const hasJobs = jobs.length > 0;

  if (!hasJobs && !panelOpen) return null;

  const collapseToFab = () => setPanelOpen(false);
  const closePanel = () => {
    // Drop settled records only; in-flight jobs keep running and show as FAB.
    clearFinished();
    setPanelOpen(false);
  };

  return (
    <div className="upload-task-dock">
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
        <section className="upload-task-panel" aria-label={t("uploadTaskPanelTitle")}>
          <header className="upload-task-panel__head">
            <div>
              <h2>{t("uploadTaskPanelTitle")}</h2>
              <p>{t("uploadTaskPanelHint")}</p>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
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
                <JobCard key={job.id} job={job} />
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

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  adminCreateEpisodeWithUploadSmart,
  adminCreateUploadDrama,
  adminGetDrama,
  adminOnlineDrama,
  adminUpdateDrama,
  adminUploadImage,
  adminYtdlpTransferJob,
} from "@velvet/api-client";
import { captureVideoFirstFrameWithMeta } from "@/lib/capture-video-frame";

export type UploadEpStatus = "pending" | "uploading" | "done" | "error" | "cancelled";
export type UploadJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type UploadPublishStatus = "waiting" | "publishing" | "published" | "failed";
/** Browser file upload vs server-side ytdlp → R2/local transfer. */
export type UploadJobKind = "upload" | "ytdlp-transfer";

export type UploadCreateDramaMeta = {
  titleEn: string;
  titleZh?: string;
  titleFr?: string;
  categorySlug: string;
  coverUrl?: string;
  descriptionEn?: string;
  descriptionZh?: string;
  freeEpisodeCount: number;
  lockMode: "ALL_FREE" | "VIP_ALL" | "FREE_FIRST_N" | null;
  buyoutCredits?: number | null;
  status: "DRAFT";
  sourceTags: string[];
  totalEpisodes?: number;
};

export type UploadEpisodeSnapshot = {
  id: string;
  fileName: string;
  fileSize: number;
  title: string;
  episodeNumber: number;
  isFree: boolean;
  previewSeconds: number;
  priceCredits: number;
  thumbnailUrl?: string;
  status: UploadEpStatus;
  error?: string;
};

export type UploadJob = {
  id: string;
  title: string;
  /** Empty until drama shell is created for "new" jobs. */
  dramaId: string;
  kind: UploadJobKind;
  mode: "new" | "append";
  preferDirect: boolean;
  /** Server-side ytdlp transfer job id (kind === "ytdlp-transfer"). */
  transferJobId?: string;
  createDrama?: UploadCreateDramaMeta;
  appendSourceTags?: string[];
  /** After all uploads succeed, wait for transcode then call online. */
  publishWhenReady?: boolean;
  publishStatus?: UploadPublishStatus;
  publishError?: string;
  status: UploadJobStatus;
  createdAt: number;
  updatedAt: number;
  error?: string;
  episodes: UploadEpisodeSnapshot[];
  watermarkEnabled?: boolean;
  watermarkX?: number;
  watermarkY?: number;
  watermarkScale?: number;
};

export type EnqueueUploadEpisode = {
  id: string;
  file: File;
  title: string;
  episodeNumber: number;
  isFree: boolean;
  previewSeconds: number;
  priceCredits: number;
  thumbnailUrl?: string;
};

export type EnqueueUploadJobInput = {
  title: string;
  /** Required for append; omit for new (created inside the queue). */
  dramaId?: string;
  mode: "new" | "append";
  preferDirect: boolean;
  publishWhenReady?: boolean;
  createDrama?: UploadCreateDramaMeta;
  appendSourceTags?: string[];
  episodes: EnqueueUploadEpisode[];
  watermarkEnabled?: boolean;
  watermarkX?: number;
  watermarkY?: number;
  watermarkScale?: number;
};

export type EnqueueTransferJobInput = {
  title: string;
  dramaId: string;
  transferJobId: string;
  totalEpisodes: number;
  /** Optional titles aligned by episodeNumber (1-based). */
  episodeTitles?: Array<{ episodeNumber: number; title?: string }>;
};

type UploadQueueContextValue = {
  jobs: UploadJob[];
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  activeCount: number;
  /** Browser File uploads that hold a transfer slot. */
  browserActiveCount: number;
  enqueueJob: (input: EnqueueUploadJobInput) => string;
  /** Monitor a server-side ytdlp → R2/local transfer in the task panel. */
  enqueueTransferJob: (input: EnqueueTransferJobInput) => string;
  cancelJob: (jobId: string) => void;
  retryEpisode: (jobId: string, episodeId: string) => void;
  retryFailed: (jobId: string) => void;
  dismissJob: (jobId: string) => void;
  clearFinished: () => void;
};

const UploadQueueContext = createContext<UploadQueueContextValue | null>(null);

/** Files live outside React state so large blobs aren't re-rendered. */
type FileBucket = Map<string, Map<string, File>>;

/** Cap concurrent drama upload jobs (episodes within a job stay sequential). */
const MAX_PARALLEL_JOBS = 2;
/** Max wait for ffmpeg HLS before auto-publish gives up. */
const PUBLISH_READY_TIMEOUT_MS = 30 * 60_000;
const PUBLISH_POLL_MS = 3_000;
/** Poll interval for server-side ytdlp transfer progress. */
const TRANSFER_POLL_MS = 2_500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type DramaEpisodeLite = {
  episodeNumber?: number;
  hlsUrl?: string | null;
  originalUrl?: string | null;
  transcodeStatus?: string | null;
};

/** Closest client-side mirror of ContentReadinessService for hosted uploads. */
function dramaEpisodesReadyForPublish(episodes: DramaEpisodeLite[]): {
  ready: boolean;
  reason?: string;
} {
  if (!episodes.length) return { ready: false, reason: "no-episodes" };
  const sorted = [...episodes].sort((a, b) => (a.episodeNumber || 0) - (b.episodeNumber || 0));
  for (let i = 0; i < sorted.length; i++) {
    const ep = sorted[i];
    const expected = i + 1;
    if ((ep.episodeNumber || 0) !== expected) {
      return { ready: false, reason: `missing-ep-${expected}` };
    }
    if (!ep.hlsUrl && !ep.originalUrl) {
      return { ready: false, reason: `no-media-${expected}` };
    }
    const raw = ep.hlsUrl || ep.originalUrl || "";
    const isHttp = /^https?:\/\//i.test(raw);
    const isOurCdn = /cdn\.velvetmovie\.space|\.r2\.dev|r2\.cloudflarestorage/i.test(raw);
    const externalOnline = isHttp && !isOurCdn;
    if (!externalOnline && ep.transcodeStatus === "FAILED") {
      return { ready: false, reason: `transcode-failed-${expected}` };
    }
    if (!externalOnline && ep.transcodeStatus !== "COMPLETED" && ep.transcodeStatus !== "READY") {
      return { ready: false };
    }
  }
  return { ready: true };
}

async function waitAndPublishDrama(dramaId: string, isCancelled: () => boolean) {
  const deadline = Date.now() + PUBLISH_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (isCancelled()) throw new Error("cancelled");
    const drama = (await adminGetDrama(dramaId)) as {
      status?: string;
      episodes?: DramaEpisodeLite[];
    };
    if (drama.status === "LIVE") return;
    const check = dramaEpisodesReadyForPublish(drama.episodes || []);
    if (check.reason?.startsWith("transcode-failed")) {
      throw new Error(check.reason);
    }
    if (check.ready) {
      if (isCancelled()) throw new Error("cancelled");
      await adminOnlineDrama(dramaId, "upload wizard auto publish");
      return;
    }
    await sleep(PUBLISH_POLL_MS);
  }
  throw new Error("publish-timeout");
}

async function ensureEpisodeThumbnail(file: File, existing?: string): Promise<string | undefined> {
  if (existing?.trim()) return existing.trim();
  try {
    const { blob } = await captureVideoFirstFrameWithMeta(file);
    const base = file.name.replace(/\.[^.]+$/, "") || "episode";
    const saved = await adminUploadImage(blob, {
      kind: "thumbnail",
      filename: `${base}-thumb.jpg`,
    });
    return saved.url;
  } catch {
    return undefined;
  }
}

function summarizeJobStatus(episodes: UploadEpisodeSnapshot[]): UploadJobStatus {
  if (episodes.some((ep) => ep.status === "uploading" || ep.status === "pending")) {
    return episodes.some((ep) => ep.status === "uploading") ||
      episodes.some((ep) => ep.status === "done" || ep.status === "error")
      ? "running"
      : "queued";
  }
  if (episodes.some((ep) => ep.status === "error")) return "failed";
  if (episodes.every((ep) => ep.status === "cancelled")) return "cancelled";
  if (episodes.every((ep) => ep.status === "done" || ep.status === "cancelled")) {
    return episodes.some((ep) => ep.status === "done") ? "completed" : "cancelled";
  }
  return "failed";
}

export function UploadQueueProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const filesRef = useRef<FileBucket>(new Map());
  const runningRef = useRef(new Set<string>());
  const transferRunningRef = useRef(new Set<string>());
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const cancelledRef = useRef(new Set<string>());
  const pumpRef = useRef<() => void>(() => undefined);

  const patchJob = useCallback((jobId: string, patch: (job: UploadJob) => UploadJob) => {
    const next = jobsRef.current.map((job) => {
      if (job.id !== jobId) return job;
      return { ...patch(job), updatedAt: Date.now() };
    });
    // Sync mirror first so the runner loop never summarizes stale episode statuses.
    jobsRef.current = next;
    setJobs(next);
  }, []);

  const runJob = useCallback(
    async (jobId: string) => {
      if (runningRef.current.has(jobId)) return;
      runningRef.current.add(jobId);

      try {
        // Create draft drama / refresh tags inside the queue so submit can return immediately.
        {
          const boot = jobsRef.current.find((j) => j.id === jobId);
          if (!boot || boot.kind === "ytdlp-transfer") return;

          if (boot.mode === "new" && !boot.dramaId) {
            if (!boot.createDrama) {
              patchJob(jobId, (j) => ({
                ...j,
                status: "failed",
                error: "Missing createDrama payload",
              }));
              return;
            }
            if (cancelledRef.current.has(jobId)) {
              patchJob(jobId, (j) => ({ ...j, status: "cancelled" }));
              return;
            }
            patchJob(jobId, (j) => ({ ...j, status: "running", error: undefined }));
            try {
              const drama = await adminCreateUploadDrama(boot.createDrama);
              patchJob(jobId, (j) => ({
                ...j,
                dramaId: drama.id,
                createDrama: undefined,
              }));
              void qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
            } catch (e) {
              const message = e instanceof Error ? e.message : String(e);
              patchJob(jobId, (j) => ({
                ...j,
                status: "failed",
                error: message,
                episodes: j.episodes.map((ep) =>
                  ep.status === "pending"
                    ? { ...ep, status: "error" as const, error: message }
                    : ep,
                ),
              }));
              return;
            }
          } else if (boot.mode === "append" && boot.dramaId && boot.appendSourceTags?.length) {
            try {
              await adminUpdateDrama(boot.dramaId, { sourceTags: boot.appendSourceTags });
              patchJob(jobId, (j) => ({ ...j, appendSourceTags: undefined }));
            } catch {
              /* non-fatal: continue uploading episodes */
            }
          }
        }

        while (true) {
          if (cancelledRef.current.has(jobId)) {
            patchJob(jobId, (job) => ({
              ...job,
              status: "cancelled",
              episodes: job.episodes.map((ep) =>
                ep.status === "pending" || ep.status === "uploading"
                  ? { ...ep, status: "cancelled" as const, error: undefined }
                  : ep,
              ),
            }));
            break;
          }

          const job = jobsRef.current.find((j) => j.id === jobId);
          if (!job) break;

          const nextEp = job.episodes.find((ep) => ep.status === "pending");
          if (!nextEp) {
            let completed = false;
            let shouldPublish = false;
            patchJob(jobId, (j) => {
              const status = summarizeJobStatus(j.episodes);
              completed = status === "completed";
              shouldPublish = completed && !!j.publishWhenReady && j.publishStatus !== "published";
              return {
                ...j,
                status: shouldPublish ? "running" : status,
                publishStatus: shouldPublish ? ("waiting" as const) : j.publishStatus,
                error: status === "failed" ? j.error : undefined,
              };
            });
            if (completed && shouldPublish) {
              runningRef.current.delete(jobId);
              queueMicrotask(() => pumpRef.current());
              try {
                patchJob(jobId, (j) => ({
                  ...j,
                  status: "running",
                  publishStatus: "publishing",
                  publishError: undefined,
                }));
                await waitAndPublishDrama(job.dramaId, () => cancelledRef.current.has(jobId));
                patchJob(jobId, (j) => ({
                  ...j,
                  status: cancelledRef.current.has(jobId) ? "cancelled" : "completed",
                  publishStatus: cancelledRef.current.has(jobId) ? "failed" : "published",
                  publishError: cancelledRef.current.has(jobId) ? "cancelled" : undefined,
                  error: undefined,
                }));
              } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                patchJob(jobId, (j) => ({
                  ...j,
                  status: message === "cancelled" ? "cancelled" : "completed",
                  publishStatus: "failed",
                  publishError: message,
                }));
              }
              void qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
              void qc.invalidateQueries({ queryKey: ["admin", "drama", job.dramaId] });
            } else if (completed) {
              void qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
            }
            break;
          }

          const file = filesRef.current.get(jobId)?.get(nextEp.id);
          if (!file) {
            patchJob(jobId, (j) => ({
              ...j,
              status: "failed",
              error: "Missing file in upload queue",
              episodes: j.episodes.map((ep) =>
                ep.id === nextEp.id
                  ? { ...ep, status: "error" as const, error: "Missing file in upload queue" }
                  : ep,
              ),
            }));
            break;
          }

          patchJob(jobId, (j) => ({
            ...j,
            status: "running",
            error: undefined,
            episodes: j.episodes.map((ep) =>
              ep.id === nextEp.id ? { ...ep, status: "uploading" as const, error: undefined } : ep,
            ),
          }));

          try {
            const live = jobsRef.current.find((j) => j.id === jobId);
            if (!live?.dramaId) throw new Error("Missing dramaId");
            const thumbnailUrl = await ensureEpisodeThumbnail(file, nextEp.thumbnailUrl);
            if (thumbnailUrl && thumbnailUrl !== nextEp.thumbnailUrl) {
              patchJob(jobId, (j) => ({
                ...j,
                episodes: j.episodes.map((ep) =>
                  ep.id === nextEp.id ? { ...ep, thumbnailUrl } : ep,
                ),
              }));
            }
            await adminCreateEpisodeWithUploadSmart(live.dramaId, file, {
              title: nextEp.title,
              episodeNumber: nextEp.episodeNumber,
              isFree: nextEp.isFree,
              previewSeconds: nextEp.isFree ? 0 : nextEp.previewSeconds,
              priceCredits: nextEp.isFree ? 0 : nextEp.priceCredits,
              thumbnailUrl,
              preferDirect: live.preferDirect,
              watermarkEnabled: live.watermarkEnabled,
              watermarkX: live.watermarkX,
              watermarkY: live.watermarkY,
              watermarkScale: live.watermarkScale,
            });

            if (cancelledRef.current.has(jobId)) {
              patchJob(jobId, (j) => ({
                ...j,
                status: "cancelled",
                episodes: j.episodes.map((ep) => {
                  if (ep.id === nextEp.id) return { ...ep, status: "done" as const, error: undefined };
                  if (ep.status === "pending") return { ...ep, status: "cancelled" as const };
                  return ep;
                }),
              }));
              break;
            }

            let completed = false;
            let shouldPublish = false;
            let publishDramaId = live.dramaId;
            patchJob(jobId, (j) => {
              const episodes = j.episodes.map((ep) =>
                ep.id === nextEp.id
                  ? { ...ep, status: "done" as const, error: undefined, thumbnailUrl: thumbnailUrl || ep.thumbnailUrl }
                  : ep,
              );
              const status = summarizeJobStatus(episodes);
              completed = status === "completed";
              shouldPublish = completed && !!j.publishWhenReady;
              publishDramaId = j.dramaId || publishDramaId;
              return {
                ...j,
                episodes,
                status: shouldPublish ? "running" : status,
                publishStatus: shouldPublish ? ("waiting" as const) : j.publishStatus,
                publishError: shouldPublish ? undefined : j.publishError,
                error: status === "failed" ? j.error : undefined,
              };
            });
            if (completed) {
              if (shouldPublish && publishDramaId) {
                // Free an upload slot while waiting for ffmpeg; publish wait is separate.
                runningRef.current.delete(jobId);
                queueMicrotask(() => pumpRef.current());
                try {
                  patchJob(jobId, (j) => ({
                    ...j,
                    status: "running",
                    publishStatus: "publishing",
                    publishError: undefined,
                  }));
                  await waitAndPublishDrama(publishDramaId, () => cancelledRef.current.has(jobId));
                  if (cancelledRef.current.has(jobId)) {
                    patchJob(jobId, (j) => ({
                      ...j,
                      status: "cancelled",
                      publishStatus: "failed",
                      publishError: "cancelled",
                    }));
                  } else {
                    patchJob(jobId, (j) => ({
                      ...j,
                      status: "completed",
                      publishStatus: "published",
                      publishError: undefined,
                      error: undefined,
                    }));
                  }
                } catch (e) {
                  const message = e instanceof Error ? e.message : String(e);
                  if (message === "cancelled" || cancelledRef.current.has(jobId)) {
                    patchJob(jobId, (j) => ({
                      ...j,
                      status: "cancelled",
                      publishStatus: "failed",
                      publishError: message,
                    }));
                  } else {
                    // Uploads succeeded; publish can be retried from drama detail.
                    patchJob(jobId, (j) => ({
                      ...j,
                      status: "completed",
                      publishStatus: "failed",
                      publishError: message,
                    }));
                  }
                }
                void qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
                void qc.invalidateQueries({ queryKey: ["admin", "drama", publishDramaId] });
              } else {
                void qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
              }
              break;
            }
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            patchJob(jobId, (j) => ({
              ...j,
              status: "failed",
              error: message,
              episodes: j.episodes.map((ep) =>
                ep.id === nextEp.id ? { ...ep, status: "error" as const, error: message } : ep,
              ),
            }));
            break;
          }
        }
      } finally {
        runningRef.current.delete(jobId);
        // Free a slot so a queued drama can start.
        queueMicrotask(() => pumpRef.current());
      }
    },
    [patchJob, qc],
  );

  const pump = useCallback(() => {
    let slots = MAX_PARALLEL_JOBS - runningRef.current.size;
    if (slots <= 0) return;
    for (const job of jobsRef.current) {
      if (slots <= 0) break;
      if (job.kind === "ytdlp-transfer") continue;
      if (cancelledRef.current.has(job.id)) continue;
      if (runningRef.current.has(job.id)) continue;
      const hasWork = job.episodes.some((ep) => ep.status === "pending");
      if (!hasWork) continue;
      if (job.status === "cancelled" || job.status === "completed") continue;
      void runJob(job.id);
      slots -= 1;
    }
  }, [runJob]);

  pumpRef.current = pump;

  useEffect(() => {
    pump();
  }, [jobs, pump]);

  const runTransferMonitor = useCallback(
    async (jobId: string) => {
      if (transferRunningRef.current.has(jobId)) return;
      transferRunningRef.current.add(jobId);
      try {
        patchJob(jobId, (j) => ({ ...j, status: "running", error: undefined }));
        while (true) {
          if (cancelledRef.current.has(jobId)) {
            patchJob(jobId, (j) => ({
              ...j,
              status: "cancelled",
              episodes: j.episodes.map((ep) =>
                ep.status === "pending" || ep.status === "uploading"
                  ? { ...ep, status: "cancelled" as const, error: undefined }
                  : ep,
              ),
            }));
            break;
          }

          const job = jobsRef.current.find((j) => j.id === jobId);
          if (!job?.transferJobId) break;

          try {
            const remote = await adminYtdlpTransferJob(job.transferJobId);
            // Server writes consecutive drama episodeNumbers into jobs[]; sourceIndex
            // keeps the staged / selected index that matches our panel rows.
            const doneNums = new Set(
              (remote.jobs || []).map((entry) =>
                Number(
                  entry.sourceIndex != null ? entry.sourceIndex : entry.episodeNumber,
                ),
              ),
            );
            const failMap = new Map(
              (remote.failedEpisodes || []).map((f) => [
                Number(f.episodeNumber),
                String(f.error || "failed"),
              ]),
            );
            const current =
              remote.currentEpisode == null ? null : Number(remote.currentEpisode);

            let finished = false;
            patchJob(jobId, (j) => {
              const episodes = j.episodes.map((ep) => {
                if (failMap.has(ep.episodeNumber)) {
                  return {
                    ...ep,
                    status: "error" as const,
                    error: failMap.get(ep.episodeNumber),
                  };
                }
                if (doneNums.has(ep.episodeNumber)) {
                  return { ...ep, status: "done" as const, error: undefined };
                }
                if (current != null && current === ep.episodeNumber) {
                  return { ...ep, status: "uploading" as const, error: undefined };
                }
                if (ep.status === "done" || ep.status === "error" || ep.status === "cancelled") {
                  return ep;
                }
                return { ...ep, status: "pending" as const, error: undefined };
              });

              if (remote.status === "completed") {
                finished = true;
                return {
                  ...j,
                  dramaId: remote.dramaId || j.dramaId,
                  status: summarizeJobStatus(episodes),
                  episodes,
                  error: undefined,
                };
              }
              if (remote.status === "failed") {
                finished = true;
                return {
                  ...j,
                  dramaId: remote.dramaId || j.dramaId,
                  status: "failed" as const,
                  episodes,
                  error: remote.error || "Transfer failed",
                };
              }
              return {
                ...j,
                dramaId: remote.dramaId || j.dramaId,
                status: "running" as const,
                episodes,
                error: undefined,
              };
            });

            if (finished) {
              void qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
              if (remote.dramaId) {
                void qc.invalidateQueries({ queryKey: ["admin", "drama", remote.dramaId] });
              }
              break;
            }
          } catch {
            // Transient poll errors — keep monitoring until cancel / terminal status.
          }

          await sleep(TRANSFER_POLL_MS);
        }
      } finally {
        transferRunningRef.current.delete(jobId);
      }
    },
    [patchJob, qc],
  );

  useEffect(() => {
    for (const job of jobs) {
      if (job.kind !== "ytdlp-transfer") continue;
      if (job.status !== "queued" && job.status !== "running") continue;
      if (cancelledRef.current.has(job.id)) continue;
      if (transferRunningRef.current.has(job.id)) continue;
      void runTransferMonitor(job.id);
    }
  }, [jobs, runTransferMonitor]);

  const enqueueJob = useCallback(
    (input: EnqueueUploadJobInput) => {
      const id = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const fileMap = new Map<string, File>();
      const episodes: UploadEpisodeSnapshot[] = input.episodes.map((ep) => {
        fileMap.set(ep.id, ep.file);
        return {
          id: ep.id,
          fileName: ep.file.name,
          fileSize: ep.file.size,
          title: ep.title,
          episodeNumber: ep.episodeNumber,
          isFree: ep.isFree,
          previewSeconds: ep.previewSeconds,
          priceCredits: ep.priceCredits,
          thumbnailUrl: ep.thumbnailUrl,
          status: "pending" as const,
        };
      });
      filesRef.current.set(id, fileMap);
      cancelledRef.current.delete(id);

      const job: UploadJob = {
        id,
        title: input.title,
        dramaId: input.dramaId ?? "",
        kind: "upload",
        mode: input.mode,
        preferDirect: input.preferDirect,
        publishWhenReady: !!input.publishWhenReady,
        createDrama: input.createDrama,
        appendSourceTags: input.appendSourceTags,
        watermarkEnabled: input.watermarkEnabled,
        watermarkX: input.watermarkX,
        watermarkY: input.watermarkY,
        watermarkScale: input.watermarkScale,
        status: "queued",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        episodes,
      };
      setJobs((prev) => {
        const next = [job, ...prev].slice(0, 30);
        jobsRef.current = next;
        return next;
      });
      setPanelOpen(true);
      return id;
    },
    [],
  );

  const enqueueTransferJob = useCallback((input: EnqueueTransferJobInput) => {
    const id = `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const total = Math.max(0, Math.floor(input.totalEpisodes));
    const titleByNum = new Map(
      (input.episodeTitles || []).map((ep) => [ep.episodeNumber, (ep.title || "").trim()]),
    );
    const episodes: UploadEpisodeSnapshot[] = Array.from({ length: total }, (_, i) => {
      const episodeNumber = i + 1;
      const title = titleByNum.get(episodeNumber) || "";
      return {
        id: `${id}-ep-${episodeNumber}`,
        fileName: title || `ep${episodeNumber}`,
        fileSize: 0,
        title,
        episodeNumber,
        isFree: true,
        previewSeconds: 0,
        priceCredits: 0,
        status: "pending" as const,
      };
    });
    cancelledRef.current.delete(id);

    const job: UploadJob = {
      id,
      title: input.title,
      dramaId: input.dramaId,
      kind: "ytdlp-transfer",
      mode: "new",
      preferDirect: true,
      transferJobId: input.transferJobId,
      status: "queued",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      episodes,
    };
    setJobs((prev) => {
      const next = [job, ...prev].slice(0, 30);
      jobsRef.current = next;
      return next;
    });
    setPanelOpen(true);
    return id;
  }, []);

  const cancelJob = useCallback((jobId: string) => {
    cancelledRef.current.add(jobId);
    const job = jobsRef.current.find((j) => j.id === jobId);
    // Transfer jobs keep running on the server; cancel only stops panel tracking.
    if (job?.kind === "ytdlp-transfer") {
      patchJob(jobId, (j) => ({
        ...j,
        status: "cancelled",
        episodes: j.episodes.map((ep) =>
          ep.status === "pending" || ep.status === "uploading"
            ? { ...ep, status: "cancelled" as const, error: undefined }
            : ep,
        ),
      }));
      return;
    }
    patchJob(jobId, (j) => ({
      ...j,
      status: j.episodes.some((ep) => ep.status === "uploading") ? "running" : "cancelled",
      episodes: j.episodes.map((ep) =>
        ep.status === "pending" ? { ...ep, status: "cancelled" as const, error: undefined } : ep,
      ),
    }));
  }, [patchJob]);

  const retryEpisode = useCallback(
    (jobId: string, episodeId: string) => {
      const job = jobsRef.current.find((j) => j.id === jobId);
      if (job?.kind === "ytdlp-transfer") return;
      cancelledRef.current.delete(jobId);
      patchJob(jobId, (j) => ({
        ...j,
        status: "queued",
        error: undefined,
        episodes: j.episodes.map((ep) =>
          ep.id === episodeId && (ep.status === "error" || ep.status === "cancelled")
            ? { ...ep, status: "pending" as const, error: undefined }
            : ep,
        ),
      }));
    },
    [patchJob],
  );

  const retryFailed = useCallback(
    (jobId: string) => {
      const job = jobsRef.current.find((j) => j.id === jobId);
      if (job?.kind === "ytdlp-transfer") return;
      cancelledRef.current.delete(jobId);
      patchJob(jobId, (j) => ({
        ...j,
        status: "queued",
        error: undefined,
        episodes: j.episodes.map((ep) =>
          ep.status === "error" || ep.status === "cancelled"
            ? { ...ep, status: "pending" as const, error: undefined }
            : ep,
        ),
      }));
    },
    [patchJob],
  );

  const dismissJob = useCallback((jobId: string) => {
    const job = jobsRef.current.find((j) => j.id === jobId);
    if (job && (job.status === "running" || job.status === "queued")) {
      cancelledRef.current.add(jobId);
    }
    filesRef.current.delete(jobId);
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
  }, []);

  const clearFinished = useCallback(() => {
    setJobs((prev) => {
      const keep: UploadJob[] = [];
      for (const job of prev) {
        if (job.status === "queued" || job.status === "running") {
          keep.push(job);
          continue;
        }
        filesRef.current.delete(job.id);
      }
      jobsRef.current = keep;
      return keep;
    });
  }, []);

  const activeCount = useMemo(
    () => jobs.filter((j) => j.status === "queued" || j.status === "running").length,
    [jobs],
  );

  const browserActiveCount = useMemo(
    () =>
      jobs.filter(
        (j) =>
          j.kind !== "ytdlp-transfer" && (j.status === "queued" || j.status === "running"),
      ).length,
    [jobs],
  );

  useEffect(() => {
    // Only browser File uploads die when the tab closes; server transfer continues.
    if (browserActiveCount <= 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [browserActiveCount]);

  const value = useMemo<UploadQueueContextValue>(
    () => ({
      jobs,
      panelOpen,
      setPanelOpen,
      activeCount,
      browserActiveCount,
      enqueueJob,
      enqueueTransferJob,
      cancelJob,
      retryEpisode,
      retryFailed,
      dismissJob,
      clearFinished,
    }),
    [
      jobs,
      panelOpen,
      activeCount,
      browserActiveCount,
      enqueueJob,
      enqueueTransferJob,
      cancelJob,
      retryEpisode,
      retryFailed,
      dismissJob,
      clearFinished,
    ],
  );

  return <UploadQueueContext.Provider value={value}>{children}</UploadQueueContext.Provider>;
}

export function useUploadQueue() {
  const ctx = useContext(UploadQueueContext);
  if (!ctx) {
    throw new Error("useUploadQueue must be used within UploadQueueProvider");
  }
  return ctx;
}

/** Optional hook when the provider may be absent (defensive). */
export function useUploadQueueOptional() {
  return useContext(UploadQueueContext);
}

import { asRows, toQuery } from "../types";
import { adminDownloadBlob, adminRequest, type AdminProfile } from "./http";
import { clearAdminToken, setAdminToken } from "./http";

export async function adminFetchCaptcha() {
  return adminRequest<{
    captchaId: string;
    imageSvg: string;
    captchaRequired: boolean;
  }>("/admin/auth/captcha");
}

export async function adminLogin(
  account: string,
  password: string,
  captcha?: { captchaId: string; captchaCode: string },
) {
  const data = await adminRequest<{ token: string; admin: AdminProfile }>("/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({
      account,
      password,
      captchaId: captcha?.captchaId ?? "",
      captchaCode: captcha?.captchaCode ?? "",
    }),
  });
  setAdminToken(data.token);
  return data;
}

export async function adminLogout() {
  try {
    await adminRequest<{ success: boolean }>("/admin/auth/logout", { method: "POST", body: "{}" });
  } catch {
    /* ignore */
  }
  clearAdminToken();
}

export async function adminMe() {
  return adminRequest<AdminProfile>("/admin/auth/me");
}

export async function adminChangePassword(oldPassword: string, newPassword: string) {
  return adminRequest<{ success: boolean }>("/admin/auth/password", {
    method: "PATCH",
    body: JSON.stringify({ oldPassword, newPassword }),
  });
}

export async function adminUpdateProfile(input: {
  email?: string;
  username?: string;
  displayName?: string;
}) {
  return adminRequest<AdminProfile>("/admin/auth/profile", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export type DashboardRange = "today" | "7d" | "30d" | "custom";

export type DashboardKpi = {
  newUsers: number;
  gmvVnd: string;
  unlockCount: number;
  platformRevenueVnd: string;
  paidOrders: number;
};

export type DashboardOverview = {
  range: DashboardRange;
  from: string | null;
  to: string | null;
  period: DashboardKpi;
  previous: DashboardKpi;
  deltas: {
    newUsersPct: number | null;
    gmvPct: number | null;
    unlockPct: number | null;
    revenuePct: number | null;
    ordersPct: number | null;
  };
  trends: Array<{
    date: string;
    newUsers: number;
    gmvVnd: string;
    unlockCount: number;
    paidOrders: number;
  }>;
  todos: {
    pendingDramas: number;
    pendingKyc: number;
    pendingWithdraws: number;
    overdueWithdraws: number;
    reconcileMismatch: number;
    transcodeFailed: number;
  };
  rankings: {
    topByView: Array<{
      id: string;
      titleZh: string | null;
      titleEn: string | null;
      slug: string | null;
      viewCount: number;
      unlockCount: number;
    }>;
    topByUnlock: Array<{
      id: string;
      titleZh: string | null;
      titleEn: string | null;
      slug: string | null;
      viewCount: number;
      unlockCount: number;
    }>;
    topBySales: Array<{
      dramaId: string;
      titleZh: string | null;
      titleEn: string | null;
      slug: string | null;
      orderCount: number;
      credits: string;
      amountVnd: string;
    }>;
  };
  bizBreakdown: {
    activeVipUsers: number;
    topup: { count: number; credits: string; amountVnd: string };
    vip: { count: number; amountVnd: string };
    unlock: { count: number; credits: string; amountVnd: string };
    dramaBuyout: { count: number; credits: string; amountVnd: string };
  };
  meta: { dramaCount: number };
};

export async function adminDashboard(
  range: DashboardRange = "7d",
  opts?: { from?: string; to?: string },
) {
  return adminRequest<DashboardOverview>(
    `/admin/dashboard/overview${toQuery({
      range,
      from: range === "custom" ? opts?.from : undefined,
      to: range === "custom" ? opts?.to : undefined,
    })}`,
  );
}

export async function adminListDramas(params: Record<string, string | number | undefined> = {}) {
  return adminRequest(`/admin/dramas${toQuery(params)}`);
}

export async function adminGetDrama(id: string) {
  return adminRequest(`/admin/dramas/${id}`);
}

export async function adminUpdateDrama(id: string, body: Record<string, unknown>) {
  return adminRequest(`/admin/dramas/${id}/update`, { method: "POST", body: JSON.stringify(body) });
}

export async function adminSubmitDramaReview(id: string) {
  return adminRequest(`/admin/dramas/${id}/submit-review`, { method: "POST", body: "{}" });
}

export async function adminApproveDrama(id: string) {
  return adminRequest(`/admin/dramas/${id}/approve`, { method: "POST", body: "{}" });
}

export async function adminRejectDrama(id: string, reason?: string) {
  return adminRequest(`/admin/dramas/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function adminOfflineDrama(id: string, reason: string) {
  return adminRequest(`/admin/dramas/${id}/offline`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function adminOnlineDrama(id: string, reason: string) {
  return adminRequest(`/admin/dramas/${id}/online`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function adminSetFeatured(id: string, value: boolean) {
  return adminRequest(`/admin/dramas/${id}/featured`, {
    method: "POST",
    body: JSON.stringify({ value }),
  });
}

export async function adminSetOfficial(id: string, value: boolean) {
  return adminRequest(`/admin/dramas/${id}/official`, {
    method: "POST",
    body: JSON.stringify({ value }),
  });
}

export async function adminSetSortWeight(id: string, weight: number) {
  return adminRequest(`/admin/dramas/${id}/sort-weight`, {
    method: "POST",
    body: JSON.stringify({ weight }),
  });
}

export async function adminListHottest() {
  return adminRequest(`/admin/dramas/hottest`);
}

export async function adminSetHottest(id: string, value: boolean) {
  return adminRequest(`/admin/dramas/${id}/hottest`, {
    method: "POST",
    body: JSON.stringify({ value }),
  });
}

export async function adminSetHottestSort(id: string, sortOrder: number) {
  return adminRequest(`/admin/dramas/${id}/hottest-sort`, {
    method: "POST",
    body: JSON.stringify({ sortOrder }),
  });
}

export async function adminReorderHottest(ids: string[]) {
  return adminRequest(`/admin/dramas/hottest/reorder`, {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export async function adminDramaEpisodes(id: string) {
  return adminRequest(`/admin/dramas/${id}/episodes`);
}

export async function adminCreateEpisode(dramaId: string, body: Record<string, unknown>) {
  return adminRequest(`/admin/dramas/${dramaId}/episodes`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function adminUpdateEpisode(id: string, body: Record<string, unknown>) {
  return adminRequest(`/admin/episodes/${id}/update`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function adminDeleteEpisode(id: string) {
  return adminRequest(`/admin/episodes/${id}/delete`, { method: "POST", body: "{}" });
}

export async function adminBatchEpisodes(
  dramaId: string,
  body: { ids: (string | number)[]; isFree?: boolean; priceCredits?: number },
) {
  return adminRequest(`/admin/dramas/${dramaId}/episodes/batch`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function adminReorderEpisodes(dramaId: string, ids: string[]) {
  return adminRequest(`/admin/dramas/${dramaId}/episodes/reorder`, {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export async function adminRetryTranscode(
  id: string,
  body?: {
    watermarkEnabled?: boolean;
    watermarkX?: number;
    watermarkY?: number;
    watermarkScale?: number;
    preferR2?: boolean;
  },
) {
  return adminRequest(`/admin/episodes/${id}/transcode-retry`, {
    method: "POST",
    body: JSON.stringify(body || {}),
  });
}

export async function adminEpisodeFirstFrame(id: string) {
  return adminRequest<{
    relativePath: string;
    url: string;
    width: number;
    height: number;
  }>(`/admin/episodes/${id}/first-frame`, { method: "POST", body: "{}" });
}

/** Resolve (if needed) then extract first video frame for watermark placement. */
export async function adminYtdlpPreviewFrame(body: {
  url: string;
  formatPreference?: "best_hls" | "best_mp4" | "best";
  playlistIndex?: number;
  cookiesFile?: string;
  authBearer?: string;
}) {
  return adminRequest<{
    relativePath: string;
    url: string;
    width: number;
    height: number;
    playUrl: string;
  }>("/admin/ytdlp/preview-frame", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function adminStorageStatus() {
  return adminRequest<{
    storageBackend: string;
    r2Enabled: boolean;
    r2Configured: boolean;
    r2DirectUpload?: boolean;
    mediaBucket: string;
    uploadBucket: string;
    cdnBase: string;
    ffmpegReady: boolean;
    transcodeQueue?: "bullmq" | "inline";
    redisConfigured?: boolean;
  }>("/admin/storage/status");
}

export type AdminStorageProbe = {
  ok: boolean;
  skipped: boolean;
  skipReason?: "r2_disabled" | "not_configured";
  latencyMs: number | null;
  error: string | null;
  mediaBucket: string;
  uploadBucket: string;
  mediaReachable: boolean | null;
  uploadReachable: boolean | null;
  endpointHost: string | null;
  region: string;
  checkedAt: string;
  /** media + upload total bytes when measurable; null if unavailable. */
  storageBytes?: number | null;
  mediaBytes?: number | null;
  uploadBytes?: number | null;
  /** True when size is partial / from a bounded ListObjects scan. */
  storageApprox?: boolean;
  storageSource?: "cloudflare_usage" | "cloudflare_graphql" | "list_approx" | null;
};

/** Live R2 connectivity check (skipped when STORAGE_BACKEND is local). */
export async function adminStorageProbe() {
  return adminRequest<{
    storageBackend: string;
    r2Enabled: boolean;
    r2Configured: boolean;
    r2DirectUpload?: boolean;
    mediaBucket: string;
    uploadBucket: string;
    cdnBase: string;
    ffmpegReady: boolean;
    transcodeQueue?: "bullmq" | "inline";
    redisConfigured?: boolean;
    probe: AdminStorageProbe;
  }>("/admin/storage/probe");
}

export type AdminOpsMonitorOverview = {
  fetchedAt: string;
  rangeHours: number;
  server: {
    available: boolean;
    collected_at: string;
    poll_interval_sec: number;
    message?: string;
    host: {
      hostname: string;
      platform: string;
      platform_release: string;
      architecture: string;
      uptime_seconds: number;
      uptime_human: string;
    };
    cpu: { percent: number; cores_logical: number; cores_physical: number; load_avg: number[] };
    memory: {
      total_gb: number;
      used_gb: number;
      available_gb: number;
      percent: number;
    };
    root_disk: {
      mount: string;
      total_gb: number;
      used_gb: number;
      free_gb: number;
      percent: number;
    } | null;
    disks: Array<{
      mount: string;
      total_gb: number;
      used_gb: number;
      free_gb: number;
      percent: number;
    }>;
    network: {
      sent_gb: number;
      recv_gb: number;
      upload_bps: number;
      download_bps: number;
      samples: Array<{ timestamp: string; upload_bps: number; download_bps: number }>;
    };
    processes?: Array<{
      name: string;
      status: string;
      cpu: number | null;
      memory: number | null;
      restarts: number | null;
      uptime_ms: number | null;
    }>;
  };
  storage: {
    storageBackend: string;
    r2Enabled: boolean;
    r2Configured: boolean;
    mediaBucket: string;
    uploadBucket: string;
    cdnBase: string;
    ffmpegReady: boolean;
    transcodeQueue?: "bullmq" | "inline";
    redisConfigured?: boolean;
    probe: AdminStorageProbe;
  };
  cloudflare: {
    configured: boolean;
    accountId: string | null;
    zoneId: string | null;
    mediaBucket: string;
    uploadBucket: string;
    rangeHours: number;
    fetchedAt: string;
    error?: string;
    r2: {
      available: boolean;
      storageBytes: number | null;
      objectOps: number;
      bytesIn: number;
      bytesOut: number;
      series: Array<{ timestamp: string; requests: number; bytes: number }>;
      byAction: Array<{ action: string; requests: number; bytes: number }>;
    };
    cdn: {
      available: boolean;
      requests: number;
      bytes: number;
      cachedRequests: number;
      cachedBytes: number;
      cacheHitRatio: number | null;
      series: Array<{
        timestamp: string;
        requests: number;
        bytes: number;
        cachedRequests?: number;
        cachedBytes?: number;
      }>;
    };
  };
  transcode: {
    episodeCounts: Record<string, number>;
    jobCounts: Record<string, number>;
    recentFailed: Array<{
      id: string;
      episodeId: string | null;
      status: string;
      error: string | null;
      attempts: number;
      createdAt: string;
      updatedAt: string;
      finishedAt: string | null;
    }>;
  };
  queue: {
    mode: "bullmq" | "inline";
    workerRunning: boolean;
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    completed: number;
    error?: string;
  };
};

export async function adminOpsMonitorOverview(hours = 24) {
  return adminRequest<AdminOpsMonitorOverview>(`/admin/ops-monitor?hours=${hours}`);
}

export async function adminDramaStorage(
  dramaId: string,
  opts?: { page?: number; pageSize?: number; includeTotals?: boolean },
) {
  const qs = new URLSearchParams();
  if (opts?.page != null) qs.set("page", String(opts.page));
  if (opts?.pageSize != null) qs.set("pageSize", String(opts.pageSize));
  if (opts?.includeTotals != null) qs.set("includeTotals", opts.includeTotals ? "1" : "0");
  const suffix = qs.toString() ? `?${qs}` : "";
  return adminRequest<{
    storageBackend: string;
    r2Enabled: boolean;
    r2Configured: boolean;
    mediaBucket: string;
    cdnBase: string;
    ffmpegReady: boolean;
    total: number;
    page: number;
    pageSize: number;
    totals?: { objectCount: number; totalBytes: number };
    episodes: Array<{
      id: string;
      episodeNumber: number;
      title?: string | null;
      hlsUrl?: string | null;
      originalUrl?: string | null;
      transcodeStatus?: string;
      uploadStatus?: string;
      r2Prefix?: string | null;
      objectCount: number;
      totalBytes: number;
      objects: Array<{ key: string; size: number; lastModified?: string }>;
    }>;
  }>(`/admin/dramas/${dramaId}/storage${suffix}`);
}

export async function adminTranscodeJob(jobId: string) {
  return adminRequest<{
    id: string;
    episodeId?: string;
    status: "queued" | "processing" | "completed" | "failed";
    outputRel?: string;
    error?: string;
  }>(`/admin/transcode/${jobId}`);
}

/** Upload video to an existing episode → transcode → R2 when enabled. */
export async function adminUploadEpisodeVideo(
  episodeId: string,
  file: File,
  watermark?: {
    watermarkEnabled?: boolean;
    watermarkX?: number;
    watermarkY?: number;
    watermarkScale?: number;
  },
) {
  const form = new FormData();
  form.append("file", file, file.name);
  if (watermark?.watermarkEnabled != null) {
    form.append("watermarkEnabled", watermark.watermarkEnabled ? "true" : "false");
  }
  if (watermark?.watermarkX != null) form.append("watermarkX", String(watermark.watermarkX));
  if (watermark?.watermarkY != null) form.append("watermarkY", String(watermark.watermarkY));
  if (watermark?.watermarkScale != null) {
    form.append("watermarkScale", String(watermark.watermarkScale));
  }
  return adminRequest<{
    jobId: string;
    transcodeStatus: string;
    relativePath: string;
    ffmpegReady: boolean;
    episode: { id: string; hlsUrl?: string; originalUrl?: string; transcodeStatus?: string };
  }>(`/admin/episodes/${episodeId}/upload`, { method: "POST", body: form });
}

/** Confirm browser R2 put onto an existing episode (replace media). */
export async function adminAttachEpisodeFromR2(
  episodeId: string,
  body: {
    key: string;
    filename?: string;
    watermarkEnabled?: boolean;
    watermarkX?: number;
    watermarkY?: number;
    watermarkScale?: number;
  },
) {
  return adminRequest<{
    jobId: string;
    transcodeStatus: string;
    relativePath: string;
    ffmpegReady: boolean;
    episode: { id: string };
    directUpload?: boolean;
  }>(`/admin/episodes/${episodeId}/from-r2`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Prefer R2 direct put for episode replace; fall back to multipart.
 */
export async function adminUploadEpisodeVideoSmart(
  episodeId: string,
  file: File,
  opts?: {
    preferDirect?: boolean;
    watermarkEnabled?: boolean;
    watermarkX?: number;
    watermarkY?: number;
    watermarkScale?: number;
  },
) {
  const watermark = {
    watermarkEnabled: opts?.watermarkEnabled,
    watermarkX: opts?.watermarkX,
    watermarkY: opts?.watermarkY,
    watermarkScale: opts?.watermarkScale,
  };
  if (opts?.preferDirect !== false) {
    try {
      const contentType = file.type || guessVideoContentType(file.name);
      const signed = await adminPresignR2Upload(file.name, contentType);
      await putFileToR2Presigned(signed.uploadUrl, file, signed.contentType || contentType);
      return await adminAttachEpisodeFromR2(episodeId, {
        key: signed.key,
        filename: file.name,
        ...watermark,
      });
    } catch (e) {
      if (opts?.preferDirect === true) throw e;
    }
  }
  return adminUploadEpisodeVideo(episodeId, file, watermark);
}

/** Create episode + upload video in one request. */
export async function adminCreateEpisodeWithUpload(
  dramaId: string,
  file: File,
  opts?: {
    title?: string;
    episodeNumber?: number;
    isFree?: boolean;
    previewSeconds?: number;
    priceCredits?: number;
    thumbnailUrl?: string;
    watermarkEnabled?: boolean;
    watermarkX?: number;
    watermarkY?: number;
    watermarkScale?: number;
  },
) {
  const form = new FormData();
  form.append("file", file, file.name);
  if (opts?.title) form.append("title", opts.title);
  if (opts?.episodeNumber != null) form.append("episodeNumber", String(opts.episodeNumber));
  if (opts?.isFree != null) form.append("isFree", opts.isFree ? "true" : "false");
  if (opts?.previewSeconds != null) form.append("previewSeconds", String(opts.previewSeconds));
  if (opts?.priceCredits != null) form.append("priceCredits", String(opts.priceCredits));
  if (opts?.thumbnailUrl) form.append("thumbnailUrl", opts.thumbnailUrl);
  if (opts?.watermarkEnabled != null) {
    form.append("watermarkEnabled", opts.watermarkEnabled ? "true" : "false");
  }
  if (opts?.watermarkX != null) form.append("watermarkX", String(opts.watermarkX));
  if (opts?.watermarkY != null) form.append("watermarkY", String(opts.watermarkY));
  if (opts?.watermarkScale != null) form.append("watermarkScale", String(opts.watermarkScale));
  return adminRequest<{
    jobId: string;
    transcodeStatus: string;
    relativePath: string;
    ffmpegReady: boolean;
    episode: { id: string };
  }>(`/admin/dramas/${dramaId}/episodes/upload`, { method: "POST", body: form });
}

export type R2PresignResult = {
  uploadUrl: string;
  bucket: string;
  key: string;
  contentType: string;
  headers: Record<string, string>;
  expiresIn: number;
  expiresAt: string;
};

/** Presign PUT to R2 velvet-uploads (browser uploads directly, bypassing Next proxy). */
export async function adminPresignR2Upload(filename: string, contentType?: string) {
  return adminRequest<R2PresignResult>("/admin/uploads/presign", {
    method: "POST",
    body: JSON.stringify({
      filename,
      contentType: contentType || guessVideoContentType(filename),
    }),
  });
}

function guessVideoContentType(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "mp4" || ext === "m4v") return "video/mp4";
  if (ext === "mov") return "video/quicktime";
  if (ext === "webm") return "video/webm";
  if (ext === "mkv") return "video/x-matroska";
  if (ext === "avi") return "video/x-msvideo";
  if (ext === "3gp") return "video/3gpp";
  if (ext === "3g2") return "video/3gpp2";
  if (ext === "wmv") return "video/x-ms-wmv";
  if (ext === "flv" || ext === "f4v") return "video/x-flv";
  if (ext === "ts" || ext === "m2ts" || ext === "mts") return "video/mp2t";
  if (ext === "mpg" || ext === "mpeg") return "video/mpeg";
  if (ext === "ogv") return "video/ogg";
  if (ext === "asf") return "video/x-ms-asf";
  return "application/octet-stream";
}

/** PUT file bytes straight to R2 (not through /api proxy). */
export async function putFileToR2Presigned(
  uploadUrl: string,
  file: File | Blob,
  contentType: string,
) {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: file,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `R2 PUT failed HTTP ${res.status}`);
  }
}

/** Confirm R2 direct upload: API pulls object → create episode → enqueue transcode. */
export async function adminCreateEpisodeFromR2(
  dramaId: string,
  body: {
    key: string;
    filename?: string;
    title?: string;
    episodeNumber?: number;
    isFree?: boolean;
    previewSeconds?: number;
    priceCredits?: number;
    thumbnailUrl?: string;
    watermarkEnabled?: boolean;
    watermarkX?: number;
    watermarkY?: number;
    watermarkScale?: number;
  },
) {
  return adminRequest<{
    jobId: string;
    transcodeStatus: string;
    relativePath: string;
    ffmpegReady: boolean;
    episode: { id: string };
    directUpload?: boolean;
  }>(`/admin/dramas/${dramaId}/episodes/from-r2`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Preferred for admin local upload when R2 credentials are configured:
 * presign → browser PUT R2 → confirm JSON (no large multipart via Next proxy).
 * Falls back to multipart when `preferDirect` is false.
 */
export async function adminCreateEpisodeWithUploadSmart(
  dramaId: string,
  file: File,
  opts?: {
    title?: string;
    episodeNumber?: number;
    isFree?: boolean;
    previewSeconds?: number;
    priceCredits?: number;
    thumbnailUrl?: string;
    preferDirect?: boolean;
    watermarkEnabled?: boolean;
    watermarkX?: number;
    watermarkY?: number;
    watermarkScale?: number;
  },
) {
  const watermark = {
    watermarkEnabled: opts?.watermarkEnabled,
    watermarkX: opts?.watermarkX,
    watermarkY: opts?.watermarkY,
    watermarkScale: opts?.watermarkScale,
  };
  if (opts?.preferDirect !== false) {
    try {
      const contentType = file.type || guessVideoContentType(file.name);
      const signed = await adminPresignR2Upload(file.name, contentType);
      await putFileToR2Presigned(signed.uploadUrl, file, signed.contentType || contentType);
      return await adminCreateEpisodeFromR2(dramaId, {
        key: signed.key,
        filename: file.name,
        title: opts?.title,
        episodeNumber: opts?.episodeNumber,
        isFree: opts?.isFree,
        previewSeconds: opts?.previewSeconds,
        priceCredits: opts?.priceCredits,
        thumbnailUrl: opts?.thumbnailUrl,
        ...watermark,
      });
    } catch (e) {
      if (opts?.preferDirect === true) throw e;
      // fall through to multipart when auto mode
    }
  }
  return adminCreateEpisodeWithUpload(dramaId, file, { ...opts, ...watermark });
}

export async function adminAppendPublicEpisodes(
  dramaId: string,
  body: {
    url: string;
    maxEpisodes?: number;
    formatPreference?: "best_hls" | "best_mp4" | "best";
    cookiesFile?: string;
    authBearer?: string;
  },
) {
  return adminRequest<{
    added: Array<{ id: string; episodeNumber: number; title?: string }>;
    skipped: Array<{ externalVideoId: string; reason: string }>;
    errors: Array<{ externalVideoId: string; error: string }>;
    extractor: string;
  }>(`/admin/dramas/${dramaId}/ytdlp/append`, { method: 'POST', body: JSON.stringify(body) });
}

export async function adminPurgeEpisodeMedia(episodeId: string) {
  return adminRequest<{ ok: boolean; purge: { r2Deleted: number; localDeleted: number } }>(
    `/admin/episodes/${episodeId}/media/purge`,
    { method: "POST", body: "{}" },
  );
}

export async function adminBatchDramas(body: {
  ids: (string | number)[];
  freeEpisodeCount?: number;
  lockMode?: "FREE_FIRST_N" | "VIP_ALL" | "ALL_FREE" | "INHERIT" | null;
  priceCredits?: number;
  buyoutCredits?: number | null;
  isFeatured?: boolean;
  isOfficial?: boolean;
  sortWeight?: number;
}) {
  return adminRequest("/admin/dramas/batch", { method: "PATCH", body: JSON.stringify(body) });
}

export async function adminBatchDramaLifecycle(body: {
  ids: (string | number)[];
  action: "offline" | "online" | "delete";
  reason?: string;
}) {
  return adminRequest<{
    action: "offline" | "online" | "delete";
    requested: number;
    updated: number;
    skipped: number;
    failed: { id: string; error: string }[];
    purge?: { r2Deleted: number; localDeleted: number };
  }>("/admin/dramas/batch-lifecycle", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function adminListBanners(all = true) {
  const data = await adminRequest(`/admin/banners?all=${all ? "1" : "0"}`);
  return asRows(data);
}

export async function adminCreateBanner(body: Record<string, unknown>) {
  return adminRequest("/admin/banners", { method: "POST", body: JSON.stringify(body) });
}

export async function adminUpdateBanner(id: string, body: Record<string, unknown>) {
  return adminRequest(`/admin/banners/${id}`, { method: "POST", body: JSON.stringify(body) });
}

export async function adminDeleteBanner(id: string) {
  return adminRequest(`/admin/banners/${id}/delete`, { method: "POST", body: "{}" });
}

export async function adminListCategories(all = true) {
  const data = await adminRequest(`/admin/categories?all=${all ? "1" : "0"}`);
  return asRows(data);
}

export async function adminCreateCategory(body: Record<string, unknown>) {
  return adminRequest("/admin/categories", { method: "POST", body: JSON.stringify(body) });
}

export async function adminUpdateCategory(slug: string, body: Record<string, unknown>) {
  return adminRequest(`/admin/categories/${slug}`, { method: "POST", body: JSON.stringify(body) });
}

export async function adminDeleteCategory(slug: string) {
  return adminRequest(`/admin/categories/${slug}/delete`, { method: "POST", body: "{}" });
}

export type UserStatsRange = "today" | "7d" | "30d" | "custom";

export type UserStatisticsOverview = {
  range: UserStatsRange | string;
  period: { start: string; end: string };
  summary: {
    totalUsers: number;
    activeUsers: number;
    newUsers: number;
    newPreviousPeriod: number;
    paidUsers: number;
    totalPaidAmountVnd: string;
    totalCreditsBalance: string;
    totalPaidTopupCredits: string;
    totalSpentCredits: string;
    totalRechargedCredits: string;
    activeVipUsers: number;
  };
  registrationTrend: Array<{ date: string; count: number }>;
  localeDistribution: Array<{ locale: string; count: number }>;
};

export async function adminUserStatistics(
  params: { range?: UserStatsRange; startDate?: string; endDate?: string } = {},
) {
  return adminRequest<UserStatisticsOverview>(
    `/admin/users/statistics/overview${toQuery(params)}`,
  );
}

export async function adminListUsers(params: Record<string, string | number | undefined> = {}) {
  return adminRequest(`/admin/users${toQuery(params)}`);
}

export async function adminCreateUser(body: {
  email: string;
  password: string;
  username?: string;
  nickname?: string;
  phone?: string;
  locale?: string;
}) {
  return adminRequest<{
    id: string;
    uuid?: string;
    email?: string | null;
    username?: string | null;
    nickname?: string | null;
    phone?: string | null;
    locale?: string;
    status?: string;
    createdAt?: string;
  }>(`/admin/users`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function adminGetUser(id: string) {
  return adminRequest(`/admin/users/${id}`);
}

export async function adminSetUserStatus(id: string, status: string, reason: string) {
  return adminRequest(`/admin/users/${id}/status`, {
    method: "POST",
    body: JSON.stringify({ status, reason }),
  });
}

export async function adminForceLogout(id: string) {
  return adminRequest(`/admin/users/${id}/force-logout`, { method: "POST", body: "{}" });
}

export async function adminResetUserPassword(id: string, password: string) {
  return adminRequest<{ ok: boolean; clearedSessions: number }>(`/admin/users/${id}/password`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export async function adminSetUserVip(
  id: string,
  body: { vipExpireAt?: string | null; extendDays?: number },
) {
  return adminRequest(`/admin/users/${id}/vip`, { method: "POST", body: JSON.stringify(body) });
}

export async function adminDeleteUser(id: string) {
  return adminRequest<{ ok: boolean; id: string }>(`/admin/users/${id}/delete`, {
    method: "POST",
    body: "{}",
  });
}

export type AdminOrderUser = {
  id?: string | number;
  email?: string | null;
  phone?: string | null;
  nickname?: string | null;
  vipExpireAt?: string | null;
};

export type AdminOrderRow = {
  id?: string | number;
  orderNo: string;
  orderType?: string;
  userId?: string | number;
  episodeId?: string | number | null;
  dramaId?: string | number | null;
  packageId?: string | number | null;
  vipPlanId?: string | number | null;
  amountVnd?: string | number;
  amountCredits?: string | number;
  creatorIncomeVnd?: string | number;
  platformFeeVnd?: string | number;
  payCurrency?: string;
  payAmount?: string | number | null;
  fxRate?: string | number | null;
  paymentMethod?: string;
  paymentStatus?: string;
  externalRef?: string | null;
  paidAt?: string | null;
  refundedAt?: string | null;
  refundReason?: string | null;
  refundStatus?: string | null;
  refundNote?: string | null;
  meta?: unknown;
  createdAt?: string;
  updatedAt?: string;
  user?: AdminOrderUser | null;
  package?: {
    id?: string | number;
    name?: string | null;
    credits?: string | number;
    baseCredits?: string | number;
    bonusCredits?: string | number;
    baseCurrency?: string;
    basePrice?: string | number;
  } | null;
  vipPlan?: {
    id?: string | number;
    name?: string | null;
    nameEn?: string;
    nameZh?: string | null;
    durationDays?: number;
    baseCurrency?: string;
    basePrice?: string | number;
  } | null;
  drama?: {
    id?: string | number;
    titleEn?: string;
    titleZh?: string | null;
    slug?: string;
  } | null;
  episode?: {
    id?: string | number;
    episodeNumber?: number;
    title?: string | null;
    dramaId?: string | number;
  } | null;
};

export type AdminOrderList = {
  rows: AdminOrderRow[];
  total: number;
  page: number;
  pageSize: number;
};

export async function adminListOrders(
  params: {
    type?: string;
    status?: string;
    method?: string;
    userId?: string;
    q?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  } = {},
) {
  return adminRequest<AdminOrderList>(`/admin/orders${toQuery(params)}`);
}

export async function adminGetOrder(orderNo: string) {
  return adminRequest<AdminOrderRow>(`/admin/orders/${encodeURIComponent(orderNo)}`);
}

export async function adminMarkPaid(orderNo: string, externalRef: string) {
  return adminRequest(`/admin/orders/${encodeURIComponent(orderNo)}/mark-paid`, {
    method: "POST",
    body: JSON.stringify({ externalRef }),
  });
}

export async function adminListRefunds(page = 1, pageSize = 20) {
  return adminRequest(`/admin/refunds/requests?page=${page}&pageSize=${pageSize}`);
}

export async function adminApproveRefund(orderNo: string) {
  return adminRequest(`/admin/refunds/${orderNo}/approve`, { method: "POST", body: "{}" });
}

export async function adminRefuseRefund(orderNo: string, reason: string) {
  return adminRequest(`/admin/refunds/${orderNo}/refuse`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function adminDownloadCsv(
  kind: "orders" | "withdraws" | "reconciliations",
  filename?: string,
) {
  return adminDownloadBlob(`/admin/exports/${kind}.csv`, filename || `${kind}.csv`);
}

export async function adminListReconciliations(page = 1, pageSize = 30) {
  return adminRequest(`/admin/reconciliations?page=${page}&pageSize=${pageSize}`);
}

export async function adminRerunReconcile(days = 1) {
  return adminRequest(`/admin/reconciliations/rerun?days=${days}`, {
    method: "POST",
    body: "{}",
  });
}

export async function adminListAuditLogs(params: Record<string, string | number | undefined> = {}) {
  return adminRequest(`/admin/audit-logs${toQuery(params)}`);
}

export async function adminListWithdraws(params: Record<string, string | number | undefined> = {}) {
  return adminRequest(`/admin/withdraws/list${toQuery(params)}`);
}

export async function adminListFeedback(params: Record<string, string | number | undefined> = {}) {
  return adminRequest(`/admin/feedback${toQuery(params)}`);
}

export async function adminSetFeedbackStatus(id: string, status: "NEW" | "REVIEWING" | "CLOSED") {
  return adminRequest(`/admin/feedback/${encodeURIComponent(id)}/status`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

export async function adminPendingWithdraws(overdueHours?: number) {
  return adminRequest(
    `/admin/withdraws/pending${overdueHours != null ? `?overdueHours=${overdueHours}` : ""}`,
  );
}

export async function adminApproveWithdraw(id: string) {
  return adminRequest(`/admin/withdraws/${id}/approve`, { method: "POST", body: "{}" });
}

export async function adminRejectWithdraw(id: string, reason?: string) {
  return adminRequest(`/admin/withdraws/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function adminListKyc(params: Record<string, string | number | undefined> = {}) {
  return adminRequest(`/admin/kyc/list${toQuery(params)}`);
}

export async function adminApproveKyc(id: string) {
  return adminRequest(`/admin/creators/${id}/kyc/approve`, { method: "POST", body: "{}" });
}

export async function adminRejectKyc(id: string, reason: string) {
  return adminRequest(`/admin/creators/${id}/kyc/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function adminWalletLedger(params: Record<string, string | number | undefined> = {}) {
  return adminRequest(`/admin/wallet/ledger${toQuery(params)}`);
}

export async function adminWalletAdjust(
  userId: string,
  deltaCredits: number,
  reason: string,
  remark?: string,
) {
  return adminRequest(`/admin/wallet/adjust?userId=${encodeURIComponent(userId)}`, {
    method: "POST",
    body: JSON.stringify({ deltaCredits, reason, remark }),
  });
}

export async function adminListVipPlans() {
  return adminRequest("/admin/vip-plans");
}

export async function adminCreateVipPlan(body: {
  nameEn: string;
  nameZh?: string;
  nameFr?: string;
  durationDays: number;
  basePrice: number;
  originalPrice?: number | null;
  sortOrder?: number;
  badge?: string;
  descEn: string;
  descZh?: string;
  descFr?: string;
  benefits?: string[];
  active?: boolean;
}) {
  return adminRequest("/admin/vip-plans", { method: "POST", body: JSON.stringify(body) });
}

export async function adminUpdateVipPlan(
  id: string,
  body: Partial<{
    nameEn: string;
    nameZh: string;
    nameFr: string;
    durationDays: number;
    basePrice: number;
    originalPrice: number | null;
    sortOrder: number;
    badge: string;
    descEn: string;
    descZh: string;
    descFr: string;
    benefits: string[];
    active: boolean;
  }>,
) {
  return adminRequest(`/admin/vip-plans/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export async function adminDeleteVipPlan(id: string) {
  return adminRequest(`/admin/vip-plans/${id}`, { method: "DELETE" });
}

export async function adminListTopupPackages() {
  return adminRequest("/admin/topup-packages");
}

export async function adminCreateTopupPackage(body: {
  name?: string;
  baseCredits: number;
  bonusCredits?: number;
  basePrice: number;
  sortOrder?: number;
  badge?: string;
  active?: boolean;
}) {
  return adminRequest("/admin/topup-packages", { method: "POST", body: JSON.stringify(body) });
}

export async function adminUpdateTopupPackage(
  id: string,
  body: Partial<{
    name: string;
    baseCredits: number;
    bonusCredits: number;
    basePrice: number;
    sortOrder: number;
    badge: string;
    active: boolean;
  }>,
) {
  return adminRequest(`/admin/topup-packages/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function adminDeleteTopupPackage(id: string) {
  return adminRequest(`/admin/topup-packages/${id}`, { method: "DELETE" });
}

export type RedeemBatchList = {
  rows: Array<{
    id: string;
    name?: string | null;
    type: "VIP" | "CREDITS" | string;
    vipDays?: number | null;
    creditsAmount?: string | null;
    quantity: number;
    expiresAt?: string | null;
    note?: string | null;
    createdAt?: string;
    unused?: number;
    used?: number;
    voided?: number;
  }>;
  total: number;
  page: number;
  pageSize: number;
};

export type RedeemCodeList = {
  rows: Array<{
    id: string;
    batchId: string;
    code?: string;
    codeHint?: string;
    type?: string;
    vipDays?: number | null;
    creditsAmount?: string | null;
    status?: string;
    usedByUserId?: string | null;
    usedBy?: { id?: string; email?: string | null; nickname?: string | null; username?: string | null } | null;
    usedAt?: string | null;
    expiresAt?: string | null;
    createdAt?: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
};

export type RedeemRedemptionList = {
  rows: Array<{
    id: string;
    type?: string;
    vipDays?: number | null;
    creditsAmount?: string | null;
    vipExpireAt?: string | null;
    orderId?: string | null;
    createdAt?: string;
    code?: string;
    codeHint?: string;
    batchId?: string;
    user?: { id?: string; email?: string | null; nickname?: string | null; username?: string | null };
  }>;
  total: number;
  page: number;
  pageSize: number;
};

export async function adminListRedeemBatches(page = 1, pageSize = 20) {
  return adminRequest<RedeemBatchList>(`/admin/redeem/batches${toQuery({ page, pageSize })}`);
}

export async function adminCreateRedeemBatch(body: {
  name?: string;
  type: "VIP" | "CREDITS";
  vipDays?: number;
  creditsAmount?: number;
  quantity: number;
  expiresAt?: string;
  note?: string;
}) {
  return adminRequest<{
    batchId: string;
    type: string;
    quantity: number;
    vipDays?: number | null;
    creditsAmount?: string | null;
    expiresAt?: string | null;
    codes: string[];
  }>("/admin/redeem/batches", { method: "POST", body: JSON.stringify(body) });
}

export async function adminVoidRedeemBatch(id: string) {
  return adminRequest<{ voided: number }>(`/admin/redeem/batches/${id}/void`, {
    method: "POST",
    body: "{}",
  });
}

export async function adminListRedeemCodes(
  params: { batchId?: string; status?: string; code?: string; page?: number; pageSize?: number } = {},
) {
  return adminRequest<RedeemCodeList>(`/admin/redeem/codes${toQuery(params)}`);
}

export async function adminVoidRedeemCodes(ids: string[]) {
  return adminRequest<{ voided: number }>("/admin/redeem/codes/void", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export async function adminListRedemptions(
  pageOrParams: number | { batchId?: string; page?: number; pageSize?: number } = 1,
  pageSize = 20,
) {
  const params =
    typeof pageOrParams === "number"
      ? { page: pageOrParams, pageSize }
      : { page: 1, pageSize: 20, ...pageOrParams };
  return adminRequest<RedeemRedemptionList>(`/admin/redeem/redemptions${toQuery(params)}`);
}

export async function adminExportRedeemBatchCsv(batchId: string) {
  return adminDownloadBlob(`/admin/redeem/batches/${batchId}/export.csv`, `redeem-batch-${batchId}.csv`);
}

export async function adminOpsSummary(from?: string, to?: string) {
  return adminRequest(`/admin/ops/summary${toQuery({ from, to })}`);
}

export async function adminOpsDramaSales(from?: string, to?: string, limit = 50) {
  return adminRequest(`/admin/ops/drama-sales${toQuery({ from, to, limit })}`);
}

export async function adminListCreators(params: Record<string, string | number | undefined> = {}) {
  return adminRequest(`/admin/creators${toQuery(params)}`);
}

export async function adminGetCreator(id: string) {
  return adminRequest(`/admin/creators/${id}`);
}

/** Ban the linked user account for a creator (SUPER_ADMIN). */
export async function adminCloseCreator(id: string) {
  return adminRequest<{
    id: string;
    userId: string;
    status: string;
    alreadyClosed?: boolean;
  }>(`/admin/creators/${id}/close`, { method: "POST", body: "{}" });
}

export async function adminListSettings() {
  return adminRequest("/admin/settings");
}

export async function adminUpdateSetting(key: string, value: unknown) {
  return adminRequest("/admin/settings", { method: "POST", body: JSON.stringify({ key, value }) });
}

export type StripePaymentGatewaySettings = {
  provider: "stripe";
  enabled: boolean;
  secret_key_env: string;
  webhook_secret_env?: string;
  secret_key_masked: string;
  webhook_endpoint_url: string;
  webhook_signing_secret: string;
  has_webhook_signing_secret: boolean;
  has_secret_key: boolean;
  has_env_webhook_secret: boolean;
  webhook_secret_source: "env" | "store" | "none";
  webhook_receiver_path: string;
  webhook_receiver_url?: string;
  enabled_events: string[];
  recommended_events: string[];
  signature_header: string;
  created_at?: string;
  updated_at?: string;
  backend_public_url?: string | null;
  checkout_enabled: boolean;
  frontend_public_url?: string;
  subscription_success_url?: string;
  subscription_cancel_url?: string;
  docs: {
    webhooks: string;
    signatures: string;
    checkout?: string;
    dashboard_developers?: string;
    dashboard_webhooks?: string;
  };
};

export async function adminGetStripePaymentGateway() {
  return adminRequest<StripePaymentGatewaySettings>("/admin/payment-gateways/stripe");
}

export async function adminUpdateStripePaymentGateway(input: {
  enabled: boolean;
  secret_key: string;
  webhook_signing_secret: string;
  enabled_events: string[];
}) {
  return adminRequest<StripePaymentGatewaySettings>("/admin/payment-gateways/stripe", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export type AdminListItem = {
  id: string;
  email: string;
  username: string;
  displayName?: string | null;
  status: string;
  role: "SUPER_ADMIN" | "OPS" | string;
  lastLoginAt?: string | null;
  createdAt?: string;
};

export async function adminListAdmins() {
  return adminRequest<AdminListItem[]>("/admin/admins");
}

export async function adminCreateAdmin(body: {
  email: string;
  password: string;
  username?: string;
  displayName?: string;
  role?: "SUPER_ADMIN" | "OPS";
}) {
  return adminRequest<AdminListItem>("/admin/admins", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function adminSetAdminRole(id: string, role: "SUPER_ADMIN" | "OPS") {
  return adminRequest(`/admin/admins/${id}/role`, {
    method: "POST",
    body: JSON.stringify({ role }),
  });
}

export async function adminSetAdminStatus(id: string, status: "ACTIVE" | "DISABLED") {
  return adminRequest(`/admin/admins/${id}/status`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

export async function adminDeleteDrama(id: string, reason?: string) {
  return adminRequest(`/admin/dramas/${id}/delete`, {
    method: "POST",
    body: JSON.stringify({ reason: reason || "" }),
  });
}

export async function adminPendingCreators() {
  return adminRequest("/admin/creators/pending");
}

export async function adminBroadcastNotification(body: {
  titleEn: string;
  titleZh?: string;
  bodyEn: string;
  bodyZh?: string;
  userId?: string;
  broadcast?: boolean;
}) {
  return adminRequest("/admin/notifications/broadcast", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function adminImportUpload(
  files: FileList | File[],
  dryRun: boolean,
  targetDramaId?: string,
) {
  const list = Array.from(files);
  if (!list.length) throw new Error("未选择文件");
  const form = new FormData();
  form.append("dryRun", dryRun ? "true" : "false");
  if (targetDramaId) form.append("targetDramaId", targetDramaId);
  for (const file of list) {
    form.append("files", file);
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    form.append("relativePaths", rel);
  }
  return adminRequest("/admin/import/upload", { method: "POST", body: form });
}

/** Upload cover/thumbnail image to instance storage. Returns `/api/v1/media/...` url. */
export async function adminUploadImage(
  file: Blob,
  opts?: { kind?: "cover" | "thumbnail" | "image"; filename?: string },
) {
  const form = new FormData();
  const name = opts?.filename || (file instanceof File ? file.name : "cover.jpg");
  form.append("file", file, name);
  form.append("kind", opts?.kind || "cover");
  return adminRequest<{
    relativePath: string;
    originalUrl: string;
    filename: string;
    size: number;
    mime: string;
    url: string;
  }>("/admin/upload/image", { method: "POST", body: form });
}

export async function adminLocalImport(
  rootPath?: string,
  dryRun?: boolean,
  targetDramaId?: string,
) {
  return adminRequest("/admin/import/local", {
    method: "POST",
    body: JSON.stringify({ rootPath, dryRun, targetDramaId }),
  });
}

export async function adminCreateOnlineDrama(body: {
  titleEn: string;
  titleZh?: string;
  titleFr?: string;
  slug?: string;
  descriptionZh?: string;
  descriptionEn?: string;
  categorySlug: string;
  coverUrl?: string;
  creatorId?: string;
  freeEpisodeCount?: number;
  lockMode?: "FREE_FIRST_N" | "VIP_ALL" | "ALL_FREE" | "INHERIT" | null;
  buyoutCredits?: number | null;
  status?: "DRAFT";
  externalRef?: string;
  /** Align with yt-dlp import: accept CDN/signed URLs without media extension. */
  relaxedPlayUrl?: boolean;
  episodes: Array<{
    sourceUrl: string;
    title?: string;
    episodeNumber?: number;
    isFree?: boolean;
    /** First-frame / uploaded episode poster URL. */
    thumbnailUrl?: string;
  }>;
}) {
  return adminRequest<{
    id: string;
    slug: string;
    status: string;
    sourceType: string;
    totalEpisodes: number;
    externalRef?: string | null;
  }>("/admin/dramas/online", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Create empty LOCAL drama shell for subsequent R2/video uploads. */
export async function adminCreateUploadDrama(body: {
  titleEn: string;
  titleZh?: string;
  titleFr?: string;
  slug?: string;
  descriptionZh?: string;
  descriptionEn?: string;
  categorySlug: string;
  coverUrl?: string;
  creatorId?: string;
  freeEpisodeCount?: number;
  lockMode?: "FREE_FIRST_N" | "VIP_ALL" | "ALL_FREE" | "INHERIT" | null;
  buyoutCredits?: number | null;
  status?: "DRAFT";
  sourceTags?: string[];
  /** Announced/planned total (> uploaded inventory) for consumer placeholders. */
  totalEpisodes?: number;
}) {
  return adminRequest<{
    id: string;
    slug: string;
    status: string;
    sourceType: string;
    totalEpisodes: number;
    storageBackend: string;
    r2Enabled: boolean;
  }>("/admin/dramas/upload", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** One-shot: create drama + upload multiple videos (sorted by filename). */
export async function adminCreateUploadDramaWithFiles(
  files: File[],
  meta: {
    titleEn: string;
    titleZh?: string;
    titleFr?: string;
    slug?: string;
    descriptionZh?: string;
    descriptionEn?: string;
    categorySlug: string;
    coverUrl?: string;
    creatorId?: string;
    freeEpisodeCount?: number;
    lockMode?: "FREE_FIRST_N" | "VIP_ALL" | "ALL_FREE";
    status?: "DRAFT";
    isFree?: boolean;
    priceCredits?: number;
  },
) {
  if (!files.length) throw new Error("未选择视频文件");
  const form = new FormData();
  form.append("titleEn", meta.titleEn);
  if (meta.titleZh) form.append("titleZh", meta.titleZh);
  if (meta.titleFr) form.append("titleFr", meta.titleFr);
  if (meta.slug) form.append("slug", meta.slug);
  if (meta.descriptionEn) form.append("descriptionEn", meta.descriptionEn);
  if (meta.descriptionZh) form.append("descriptionZh", meta.descriptionZh);
  form.append("categorySlug", meta.categorySlug);
  if (meta.coverUrl) form.append("coverUrl", meta.coverUrl);
  if (meta.creatorId) form.append("creatorId", meta.creatorId);
  if (meta.freeEpisodeCount != null) form.append("freeEpisodeCount", String(meta.freeEpisodeCount));
  if (meta.lockMode) form.append("lockMode", meta.lockMode);
  if (meta.status) form.append("status", meta.status);
  if (meta.isFree != null) form.append("isFree", meta.isFree ? "true" : "false");
  if (meta.priceCredits != null) form.append("priceCredits", String(meta.priceCredits));
  for (const file of files) {
    form.append("files", file, file.name);
  }
  return adminRequest<{
    id: string;
    slug: string;
    status: string;
    totalEpisodes: number;
    r2Enabled?: boolean;
    storageBackend?: string;
    ffmpegReady: boolean;
    jobs: Array<{ episodeId: string; jobId: string; filename: string }>;
  }>("/admin/dramas/upload-with-files", { method: "POST", body: form });
}

/** Translate titles from English via LLM; overwrites zh/fr in one response. */
export async function adminTranslateTitles(body: {
  titleZh?: string;
  titleEn?: string;
  titleFr?: string;
}) {
  return adminRequest<{
    titleZh: string;
    titleEn: string;
    titleFr: string;
    filled: Array<"titleZh" | "titleEn" | "titleFr">;
    model: string;
  }>("/admin/translate/titles", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function adminYtdlpStatus() {
  return adminRequest<{
    configured: boolean;
    enabled: boolean;
    autoInstall: boolean;
    bin: string | null;
    binSource: "env" | "bundled" | "path" | "auto_download" | null;
    version: string | null;
    provider: string;
    requiresApiKey: boolean;
    lastError: string | null;
    openaiConfigured?: boolean;
    openaiModel?: string | null;
    auth?: {
      globalCookiesConfigured: boolean;
      cookiesDir: string;
      hostCookieFiles: string[];
      bearerConfigured: boolean;
      extraHeaders: number;
    };
  }>("/admin/ytdlp/status");
}

export async function adminYtdlpAiExtract(
  url: string,
  opts?: {
    maxEpisodes?: number;
    cookiesFile?: string;
    authBearer?: string;
  },
) {
  return adminRequest<{
    extractor: string;
    id: string;
    title: string;
    coverUrl?: string;
    description?: string;
    webpageUrl: string;
    kind: "single" | "playlist";
    source: "ai";
    titleZh?: string;
    titleEn?: string;
    /** Inferred catalog slug when heuristics/LLM could pick one. */
    categorySlug?: string;
    notes?: string;
    model?: string;
    htmlChars: number;
    textChars: number;
    episodes: Array<{
      index: number;
      id: string;
      title: string;
      durationSec?: number;
      webpageUrl: string;
      sourceUrl?: string;
      playlistIndex?: number;
      candidateCount: number;
    }>;
  }>("/admin/ytdlp/ai-extract", {
    method: "POST",
    body: JSON.stringify({
      url,
      maxEpisodes: opts?.maxEpisodes,
      cookiesFile: opts?.cookiesFile,
      authBearer: opts?.authBearer,
    }),
  });
}

/** Infer catalog category for fill-to-main when probe has no categorySlug. */
export async function adminYtdlpInferCategory(body: {
  categorySlug?: string;
  title?: string;
  description?: string;
  pageLabels?: string[];
}) {
  return adminRequest<{
    categorySlug: string | null;
    via: "explicit" | "page" | "heuristic" | "llm" | null;
    note: string | null;
    model: string | null;
  }>("/admin/ytdlp/infer-category", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Batch yt-dlp resolve after AI extract (episode pages → playable URLs). */
export async function adminYtdlpResolveBatch(body: {
  episodes: Array<{ index?: number; url: string; playlistIndex?: number }>;
  formatPreference?: "best_hls" | "best_mp4" | "best";
  maxEpisodes?: number;
  cookiesFile?: string;
  authBearer?: string;
}) {
  return adminRequest<{
    total: number;
    resolvedCount: number;
    failedCount: number;
    formatPreference: string;
    resolved: Array<{
      index: number;
      webpageUrl: string;
      playUrl: string;
      alreadyDirect?: boolean;
    }>;
    failed: Array<{ index: number; webpageUrl: string; error: string }>;
  }>("/admin/ytdlp/resolve-batch", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function adminYtdlpProbe(
  url: string,
  auth?: { cookiesFile?: string; authBearer?: string },
) {
  return adminRequest<{
    extractor: string;
    id: string;
    title: string;
    coverUrl?: string;
    description?: string;
    webpageUrl: string;
    kind: "single" | "playlist";
    episodes: Array<{
      index: number;
      id: string;
      title: string;
      durationSec?: number;
      webpageUrl: string;
      playlistIndex?: number;
      candidateCount: number;
    }>;
  }>("/admin/ytdlp/probe", {
    method: "POST",
    body: JSON.stringify({
      url,
      cookiesFile: auth?.cookiesFile,
      authBearer: auth?.authBearer,
    }),
  });
}

export async function adminYtdlpImport(body: {
  url: string;
  categorySlug?: string;
  titleZh?: string;
  titleEn?: string;
  maxEpisodes?: number;
  formatPreference?: "best_hls" | "best_mp4" | "best";
  cookiesFile?: string;
  authBearer?: string;
}) {
  return adminRequest<{
    id: string;
    slug: string;
    status: string;
    totalEpisodes: number;
    resolvedEpisodes: number;
    externalRef: string;
    extractor: string;
    kind: "single" | "playlist";
    failedEpisodes: Array<{ episodeNumber: number; url: string; error: string }>;
  }>("/admin/ytdlp/import", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function adminYtdlpResolve(body: {
  url: string;
  formatPreference?: "best_hls" | "best_mp4" | "best";
  playlistIndex?: number;
  cookiesFile?: string;
  authBearer?: string;
}) {
  return adminRequest<{
    playUrl: string;
    originalUrl: string;
  }>("/admin/ytdlp/resolve", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Server-side yt-dlp download → browser attachment (bypasses CDN CORS). */
export async function adminYtdlpDownloadEpisode(body: {
  url: string;
  formatPreference?: "best_hls" | "best_mp4" | "best";
  playlistIndex?: number;
  filenameHint?: string;
  cookiesFile?: string;
  authBearer?: string;
}) {
  const hint = (body.filenameHint || "episode").trim() || "episode";
  const filename = /\.[a-z0-9]{2,5}$/i.test(hint) ? hint : `${hint}.mp4`;
  await adminDownloadBlob("/admin/ytdlp/download", filename, {
    method: "POST",
    body: JSON.stringify({
      url: body.url,
      formatPreference: body.formatPreference || "best_mp4",
      playlistIndex: body.playlistIndex,
      filenameHint: filename,
      cookiesFile: body.cookiesFile,
      authBearer: body.authBearer,
    }),
  });
}

export async function adminYtdlpUploadCookies(file: File, hostname: string) {
  const form = new FormData();
  form.append("file", file, file.name || `${hostname}.txt`);
  form.append("hostname", hostname);
  return adminRequest<{ filename: string; absPath: string; bytes: number }>(
    "/admin/ytdlp/cookies",
    { method: "POST", body: form },
  );
}

export type YtdlpTransferJob = {
  id: string;
  dramaId: string;
  slug: string;
  status: "queued" | "running" | "completed" | "failed";
  target: "local" | "r2";
  preferR2: boolean;
  total: number;
  transferred: number;
  currentEpisode: number | null;
  failedEpisodes: Array<{ episodeNumber: number; url: string; error: string }>;
  jobs: Array<{
    episodeId: string;
    episodeNumber: number;
    jobId: string;
    filename: string;
    size: number;
    webpageUrl?: string;
    downloadUrl?: string;
    sourceIndex?: number;
  }>;
  previewUrl?: string;
  extractor?: string;
  kind?: "single" | "playlist";
  externalRef?: string;
  sourceType?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export async function adminYtdlpTransfer(body: {
  url: string;
  categorySlug?: string;
  target: "local" | "r2";
  titleZh?: string;
  titleEn?: string;
  coverUrl?: string;
  descriptionEn?: string;
  descriptionZh?: string;
  creatorId?: string;
  maxEpisodes?: number;
  formatPreference?: "best_hls" | "best_mp4" | "best";
  cookiesFile?: string;
  authBearer?: string;
  freeEpisodeCount?: number;
  lockMode?: "FREE_FIRST_N" | "VIP_ALL" | "ALL_FREE" | "INHERIT" | null;
  buyoutCredits?: number | null;
  watermarkEnabled?: boolean;
  watermarkX?: number;
  watermarkY?: number;
  watermarkScale?: number;
  episodes?: Array<{
    episodeNumber?: number;
    title?: string;
    webpageUrl?: string;
    sourceUrl?: string;
    playlistIndex?: number;
    durationSec?: number;
  }>;
}) {
  return adminRequest<{
    jobId: string;
    id: string;
    slug: string;
    status: string;
    jobStatus: "queued" | "running" | "completed" | "failed";
    sourceType: string;
    target: "local" | "r2";
    preferR2: boolean;
    storageBackend: string;
    r2Configured: boolean;
    ffmpegReady: boolean;
    extractor: string;
    kind: "single" | "playlist";
    externalRef: string;
    totalEpisodes: number;
    transferredEpisodes: number;
    failedEpisodes: Array<{ episodeNumber: number; url: string; error: string }>;
    jobs: Array<{
      episodeId: string;
      episodeNumber: number;
      jobId: string;
      filename: string;
      size: number;
    }>;
    async: true;
  }>("/admin/ytdlp/transfer", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function adminYtdlpTransferJob(jobId: string) {
  return adminRequest<YtdlpTransferJob>(
    `/admin/ytdlp/transfer/${encodeURIComponent(jobId)}`,
  );
}

/** Gap-fill a completed/failed transfer (realign sourceIndex + download missing). */
export async function adminYtdlpTransferResume(
  jobId: string,
  body?: { realignEpisodeNumbers?: boolean },
) {
  return adminRequest<{
    resumed: boolean;
    reason?: "already_complete";
    jobId?: string;
    parentJobId: string;
    dramaId: string;
    slug: string;
    missing: number;
    missingIndexes?: number[];
    totalEpisodes?: number;
    target?: "local" | "r2";
    preferR2?: boolean;
    jobStatus?: "queued";
    async?: true;
  }>(`/admin/ytdlp/transfer/${encodeURIComponent(jobId)}/resume`, {
    method: "POST",
    body: JSON.stringify(body ?? { realignEpisodeNumbers: true }),
  });
}

export async function adminTelegramStatus() {
  return adminRequest<{
    enabled: boolean;
    sidecarUrl: string | null;
    health: {
      ok: boolean;
      configured: boolean;
      sessionExists: boolean;
      authorized: boolean;
      user?: { id?: number; username?: string | null; phone?: string | null } | null;
      error?: string | null;
      uploadDir?: string;
    } | null;
    r2Configured?: boolean;
    ffmpegReady?: boolean;
    storageBackend?: string;
  }>("/admin/telegram/status");
}

export async function adminTelegramProbe(body: {
  channel: string;
  mode?: "recent" | "range";
  recentN?: number;
  fromId?: number;
  toId?: number;
  mediaOnly?: boolean;
}) {
  return adminRequest<{
    channel: string;
    count: number;
    extractor: string;
    kind: "playlist";
    items: Array<{
      messageId: number;
      date?: string | null;
      title: string;
      text?: string;
      mediaKind: string;
      hasVideo: boolean;
      size?: number | null;
      duration?: number | null;
      filename?: string | null;
      webpageUrl: string;
    }>;
    episodes: Array<{
      index: number;
      id: string;
      title: string;
      webpageUrl: string;
      messageId: number;
      durationSec?: number | null;
      size?: number | null;
      hasVideo: boolean;
      mediaKind: string;
      candidateCount: number;
    }>;
  }>("/admin/telegram/probe", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function adminTelegramTransfer(body: {
  channel: string;
  categorySlug?: string;
  titleZh?: string;
  titleEn?: string;
  coverUrl?: string;
  descriptionEn?: string;
  descriptionZh?: string;
  creatorId?: string;
  freeEpisodeCount?: number;
  lockMode?: "FREE_FIRST_N" | "VIP_ALL" | "ALL_FREE" | "INHERIT" | null;
  buyoutCredits?: number | null;
  watermarkEnabled?: boolean;
  watermarkX?: number;
  watermarkY?: number;
  watermarkScale?: number;
  episodes: Array<{
    messageId: number;
    title?: string;
    webpageUrl?: string;
    episodeNumber?: number;
    durationSec?: number | null;
  }>;
}) {
  return adminRequest<{
    jobId: string;
    id: string;
    slug: string;
    status: string;
    jobStatus: "queued";
    sourceType: string;
    target: "r2";
    preferR2: true;
    extractor: "telegram";
    kind: "single" | "playlist";
    externalRef: string;
    totalEpisodes: number;
    transferredEpisodes: number;
    async: true;
    channel: string;
  }>("/admin/telegram/transfer", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function adminTelegramTransferJob(jobId: string) {
  return adminRequest<YtdlpTransferJob>(
    `/admin/telegram/transfer/${encodeURIComponent(jobId)}`,
  );
}

export async function adminSettleT7(days = 0) {
  return adminRequest(`/admin/settle-t7?days=${days}`, { method: "POST", body: "{}" });
}

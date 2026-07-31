import type { Category, Drama, Episode } from "./mock-data";

// 相对路径：dev 下由 next.config 代理到 :4000；静态导出无后端时回退 mock
const API_BASE = "/api/v1";

export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(typeof message === "string" ? message : String(message ?? `HTTP ${status}`));
  }
}

function normalizeApiMessage(message: unknown, fallback: string): string {
  if (typeof message === "string" && message.trim()) return message;
  if (Array.isArray(message)) {
    const parts = message
      .map((m) => {
        if (typeof m === "string") return m;
        if (m && typeof m === "object" && "constraints" in (m as object)) {
          return Object.values((m as { constraints: Record<string, string> }).constraints).join(", ");
        }
        try {
          return JSON.stringify(m);
        } catch {
          return "";
        }
      })
      .filter(Boolean);
    if (parts.length) return parts.join("; ");
  }
  return fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("dv_token");
    if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  const json = (await res.json().catch(() => ({}))) as ApiEnvelope<T> & { message?: unknown };
  if (!res.ok) {
    throw new ApiError(res.status, normalizeApiMessage(json.message, `HTTP ${res.status}`));
  }
  if (json.code !== 0) {
    throw new ApiError(json.code, normalizeApiMessage(json.message, `code ${json.code}`));
  }
  return json.data;
}

// ---- 字段映射：API 响应 → 前端模型 ----
function mapDrama(d: any): Drama {
  const cover = d.coverUrl || "";
  return {
    id: d.slug || String(d.id),
    numericId: d.id != null ? String(d.id) : undefined,
    titleVi: d.titleVi || "",
    titleZh: d.titleZh || "",
    descVi: d.descriptionVi || "",
    descZh: d.descriptionZh || "",
    categorySlug: d.categorySlug || "",
    cover: [cover, cover],
    isVip: !!d.isOfficial,
    rating: 0,
    year: d.publishedAt ? new Date(d.publishedAt).getFullYear() : new Date().getFullYear(),
    episodesCount: d.totalEpisodes || (d.episodes ? d.episodes.length : 0),
    freeCount: d.freeEpisodeCount || 0,
    pricePerEp: 0,
    creator: d.creator
      ? {
          displayName: d.creator.displayName || "",
          avatarUrl: d.creator.avatarUrl || null,
        }
      : undefined,
    episodes: Array.isArray(d.episodes) ? d.episodes.map(mapEpisode) : [],
  };
}

function mapEpisode(e: any): Episode {
  return {
    id: e.id,
    no: e.episodeNumber,
    titleVi: e.title || `Tập ${e.episodeNumber}`,
    titleZh: e.title || `第 ${e.episodeNumber} 集`,
    isFree: !!e.isFree,
    // 平台原子定价为积分（priceCredits）；回退 priceVnd
    price: Number(e.priceCredits ?? e.priceVnd ?? 0),
    unlocked: e.unlocked != null ? !!e.unlocked : !!e.isFree,
  };
}

// ---- 对外数据加载（带 mock 兜底）----
export async function loadCategories(): Promise<Category[]> {
  try {
    return await request<Category[]>("/categories");
  } catch {
    const { categories } = await import("./mock-data");
    return categories;
  }
}

export async function loadHome(
  page = 1,
  pageSize = 12,
  opts?: { category?: string; q?: string; sort?: "latest" | "hot" },
): Promise<{ rows: Drama[]; total: number }> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (opts?.category) params.set("category", opts.category);
  if (opts?.q) params.set("q", opts.q);
  if (opts?.sort) params.set("sort", opts.sort);
  try {
    const r = await request<{ rows: any[]; total: number }>(`/dramas?${params.toString()}`);
    return { rows: r.rows.map(mapDrama), total: r.total };
  } catch {
    const { mockHome } = await import("./mock-data");
    return mockHome(page, pageSize, opts);
  }
}

export async function loadFeatured(): Promise<Drama[]> {
  try {
    // /dramas/featured 返回 { code, data: Drama[] }；request 已解开 data 为数组
    const list = await request<any[]>("/dramas/featured");
    return list.map(mapDrama);
  } catch {
    const { featuredDramas } = await import("./mock-data");
    return featuredDramas;
  }
}

export async function loadDramaDetail(slug: string): Promise<{ drama: Drama; episodes: Episode[] } | null> {
  try {
    const d = await request<any>(`/dramas/${slug}`);
    // 详情里的 episodes 不含 unlocked；再拉一次带用户态的剧集列表
    let episodes = (d.episodes || []).map(mapEpisode);
    try {
      const eps = await request<{ rows: any[] }>(`/dramas/${slug}/episodes`);
      if (eps?.rows?.length) episodes = eps.rows.map(mapEpisode);
    } catch {
      /* 未登录时仍用详情集列表 */
    }
    return { drama: mapDrama(d), episodes };
  } catch {
    const { mockDramaDetail } = await import("./mock-data");
    return mockDramaDetail(slug);
  }
}

// ---- 鉴权 ----
export async function sendOtp(phone: string) {
  return request<{ expiresInSec: number; devCode?: string }>("/auth/phone-number/send-otp", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}
export async function verifyOtp(phone: string, code: string) {
  const res = await fetch(`${API_BASE}/auth/phone-number/verify`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, code }),
  });
  const json = (await res.json()) as ApiEnvelope<{ token: string; user?: any }>;
  if (json.code !== 0) throw new ApiError(json.code, json.message);
  if (typeof window !== "undefined" && json.data?.token) {
    localStorage.setItem("dv_token", json.data.token);
  }
  return json.data;
}

export type EmailOtpPurpose = "login" | "register" | "reset";

function saveToken(token?: string) {
  if (typeof window !== "undefined" && token) {
    localStorage.setItem("dv_token", token);
  }
}

async function authPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as ApiEnvelope<T & { token?: string }>;
  if (json.code !== 0) throw new ApiError(json.code, json.message);
  if (json.data && typeof json.data === "object" && "token" in json.data) {
    saveToken((json.data as { token?: string }).token);
  }
  return json.data;
}

export async function sendEmailOtp(email: string, purpose: EmailOtpPurpose = "login") {
  return request<{ expiresInSec: number; devCode?: string; mailed?: boolean; purpose?: string }>(
    "/auth/email/send-otp",
    { method: "POST", body: JSON.stringify({ email, purpose }) },
  );
}
export async function verifyEmailOtp(email: string, code: string) {
  return authPost<{ token: string; user?: any }>("/auth/email/verify", { email, code });
}

export async function registerEmail(opts: {
  email: string;
  username: string;
  password: string;
  code?: string;
  nickname?: string;
}) {
  return authPost<{ token: string; user?: any }>("/auth/email/register", opts);
}

/** 账号或邮箱 + 密码登录 */
export async function loginWithPassword(account: string, password: string) {
  return authPost<{ token: string; user?: any }>("/auth/email/login", {
    account,
    password,
  });
}

export async function forgotPassword(email: string) {
  return request<{ expiresInSec: number; devCode?: string; mailed?: boolean }>(
    "/auth/email/forgot",
    { method: "POST", body: JSON.stringify({ email }) },
  );
}

export async function resetPassword(opts: { email: string; code: string; password: string }) {
  return authPost<{ token: string; user?: any }>("/auth/email/reset", opts);
}

/** 鉴权通道能力（内测 password；公测 emailOtp/phoneOtp） */
export async function getAuthChannels(): Promise<{
  password: boolean;
  registerRequiresOtp: boolean;
  emailOtp: { enabled: boolean; configured: boolean; resetAlwaysOn: boolean };
  phoneOtp: { enabled: boolean; configured: boolean };
}> {
  return request("/auth/channels");
}

export async function getSession(): Promise<{
  phone: string | null;
  email: string | null;
  username?: string | null;
  nickname: string | null;
  locale: string;
  id?: string;
  hasPassword?: boolean;
} | null> {
  try {
    return await request("/auth/session");
  } catch {
    return null;
  }
}
export async function logout() {
  try {
    await request("/auth/sign-out", { method: "POST" });
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined") localStorage.removeItem("dv_token");
}

// ---- 用户中心 ----
export async function getMe() {
  return request<any>("/users/me");
}
export async function updateMe(body: { nickname?: string; locale?: string; avatarUrl?: string }) {
  return request<any>("/users/me", { method: "PATCH", body: JSON.stringify(body) });
}
export async function getFavorites(page = 1, group?: string) {
  const qs = new URLSearchParams({ page: String(page) });
  if (group) qs.set("group", group);
  return request<{ rows: any[]; total: number; page: number; pageSize: number }>(
    `/users/me/favorites?${qs}`,
  );
}
export async function getFavoriteGroups() {
  return request<string[]>("/users/me/favorites/groups");
}
export async function addFavorite(
  dramaId: string | number,
  body?: { group?: string; note?: string },
) {
  return request<any>(`/users/me/favorites/${dramaId}`, {
    method: "POST",
    body: JSON.stringify(body || {}),
  });
}
export async function updateFavorite(
  dramaId: string | number,
  body: { group?: string | null; note?: string | null },
) {
  return request<any>(`/users/me/favorites/${dramaId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
export async function removeFavorite(dramaId: string | number) {
  return request<any>(`/users/me/favorites/${dramaId}`, { method: "DELETE" });
}
export async function getWatchHistory(page = 1, dramaId?: string) {
  const qs = new URLSearchParams({ page: String(page) });
  if (dramaId) qs.set("dramaId", String(dramaId));
  return request<{ rows: any[]; total: number; page: number; pageSize: number }>(
    `/users/me/history?${qs}`,
  );
}
export async function clearWatchHistory() {
  return request<any>("/users/me/history", { method: "DELETE" });
}
export async function uploadAvatar(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  const headers: Record<string, string> = {};
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("dv_token");
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}/users/me/avatar`, {
    method: "POST",
    credentials: "include",
    headers,
    body: fd,
  });
  const json = (await res.json()) as ApiEnvelope<any>;
  if (json.code !== 0) throw new ApiError(json.code, json.message);
  return json.data;
}
export async function getWalletTransactions(page = 1) {
  return request<{ rows: any[]; total: number; page: number; pageSize: number }>(
    `/wallet/transactions?page=${page}`,
  );
}
export async function getMyOrders(page = 1) {
  return request<{ rows: any[]; total: number; page: number; pageSize: number }>(
    `/orders?page=${page}`,
  );
}

// ---- 钱包 / 解锁 ----
export async function getWallet(): Promise<{
  balanceCredits: number;
  totalRechargedCredits: number;
  totalSpentCredits: number;
} | null> {
  try {
    return await request("/wallet");
  } catch {
    return null;
  }
}

// 币换积分：法币充值下单（返回 credits + devPayUrl）
export async function topupOrder(
  packageId: string | number,
  currency: string,
  paymentMethod = "STRIPE",
) {
  return request<any>("/orders/topup", {
    method: "POST",
    body: JSON.stringify({ packageId, currency, paymentMethod }),
  });
}

// 开发态：模拟支付成功（替代真实渠道）
export async function simulatePay(orderNo: string) {
  return request<any>("/payments/simulate", {
    method: "POST",
    body: JSON.stringify({ orderNo }),
  });
}

export type TopupPackageQuote = {
  id: string;
  name: string | null;
  credits: string;
  baseCurrency: string;
  basePrice: string;
  payCurrency?: string;
  payAmount?: string;
  cnyToFiat?: string;
};

/** 公开积分套餐（含指定币种应付价） */
export async function getTopupPackages(currency = "CNY"): Promise<TopupPackageQuote[]> {
  try {
    return await request(`/topup-packages?currency=${encodeURIComponent(currency)}`);
  } catch {
    return [];
  }
}

// 汇率表（公开）：cnyToFiat = 1 CNY 换多少该币
export async function getExchangeRates(): Promise<
  { currency: string; cnyToFiat: string; buyRate: string; sellRate: string }[]
> {
  try {
    return await request("/exchange-rates");
  } catch {
    return [];
  }
}
export async function unlockEpisode(episodeId: string | number) {
  try {
    return await request<any>("/orders/unlock-episode", {
      method: "POST",
      body: JSON.stringify({ episodeId }),
    });
  } catch (e) {
    // 真实后端明确拒绝（余额不足等）→ 照常抛错
    if (e instanceof ApiError) throw e;
    // 后端不可达（如静态预览无后端）→ 本地模拟成功，保证可玩
    return { unlocked: true, alreadyUnlocked: false, mock: true };
  }
}

export async function getPlayUrl(episodeId: string | number) {
  return request<{ playUrl: string; expiresAt: string; durationSec: number }>(
    `/episodes/${episodeId}/play`,
  );
}

// ---- 创作者中心 ----
export async function creatorDashboard() {
  return request<any>("/creator/dashboard");
}
export async function creatorDramas() {
  return request<any[]>("/creator/dramas");
}
export async function creatorCreateDrama(body: Record<string, unknown>) {
  return request<any>("/creator/dramas", { method: "POST", body: JSON.stringify(body) });
}
export async function creatorAddEpisode(dramaId: string, body: Record<string, unknown>) {
  return request<any>(`/creator/dramas/${dramaId}/episodes`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
export async function creatorSubmitReview(dramaId: string) {
  return request<any>(`/creator/dramas/${dramaId}/submit-review`, { method: "POST", body: "{}" });
}
export async function creatorKycStatus() {
  return request<any>("/creator/kyc/status");
}
export async function creatorSubmitKyc(body: Record<string, unknown>) {
  return request<any>("/creator/kyc/submit", { method: "POST", body: JSON.stringify(body) });
}
export async function creatorEarnings(page = 1) {
  return request<any>(`/creator/earnings?page=${page}`);
}
export async function creatorEarningsDaily(opts?: { from?: string; to?: string; days?: number }) {
  const qs = new URLSearchParams();
  if (opts?.from) qs.set("from", opts.from);
  if (opts?.to) qs.set("to", opts.to);
  if (opts?.days != null) qs.set("days", String(opts.days));
  const q = qs.toString();
  return request<{ rows: { day: string; totalVnd: string; orders: number }[]; days: number }>(
    `/creator/earnings/daily${q ? `?${q}` : ""}`,
  );
}
export async function creatorEarningsOrders(opts?: { from?: string; to?: string; page?: number }) {
  const qs = new URLSearchParams();
  if (opts?.from) qs.set("from", opts.from);
  if (opts?.to) qs.set("to", opts.to);
  if (opts?.page != null) qs.set("page", String(opts.page));
  const q = qs.toString();
  return request<any>(`/creator/earnings/orders${q ? `?${q}` : ""}`);
}
export async function creatorUpdateDrama(dramaId: string, body: Record<string, unknown>) {
  return request<any>(`/creator/dramas/${dramaId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
export async function creatorDeleteDrama(dramaId: string) {
  return request<any>(`/creator/dramas/${dramaId}`, { method: "DELETE" });
}
export async function creatorOfflineDrama(dramaId: string) {
  return request<any>(`/creator/dramas/${dramaId}/offline`, { method: "POST", body: "{}" });
}
export async function creatorDeleteEpisode(episodeId: string) {
  return request<any>(`/creator/episodes/${episodeId}`, { method: "DELETE" });
}
export async function creatorWithdraws(page = 1) {
  return request<any>(`/creator/withdraws?page=${page}`);
}
export async function creatorCreateWithdraw(amountVnd: number, bankInfo: Record<string, string>) {
  return request<any>("/creator/withdraws", {
    method: "POST",
    body: JSON.stringify({ amountVnd, bankInfo }),
  });
}

export async function creatorUploadVideo(file: File, opts?: { episodeId?: string; transcode?: boolean }) {
  const fd = new FormData();
  fd.append("file", file);
  if (opts?.episodeId) fd.append("episodeId", opts.episodeId);
  if (opts?.transcode) fd.append("transcode", "1");
  const headers: Record<string, string> = {};
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("dv_token");
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}/creator/upload`, {
    method: "POST",
    credentials: "include",
    headers,
    body: fd,
  });
  const json = (await res.json()) as ApiEnvelope<any>;
  if (json.code !== 0) throw new ApiError(json.code, json.message);
  return json.data;
}

export async function creatorTranscodeStatus(jobId: string) {
  return request<any>(`/creator/transcode/${jobId}`);
}

export async function getPaymentMethods(region = "CN") {
  try {
    return await request<{ method: string; label: string; region: string; ready?: boolean }[]>(
      `/payment-methods?region=${region}`,
    );
  } catch {
    return [];
  }
}

// ---- 管理后台（账号密码 JWT；兼容旧 x-admin-token）----
const ADMIN_TOKEN_KEY = "dv_admin_token";

export type AdminProfile = {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  role?: "SUPER_ADMIN" | "OPS";
};

export function getAdminToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(ADMIN_TOKEN_KEY) || "";
}
export function setAdminToken(token: string) {
  if (typeof window !== "undefined") localStorage.setItem(ADMIN_TOKEN_KEY, token);
}
export function clearAdminToken() {
  if (typeof window !== "undefined") localStorage.removeItem(ADMIN_TOKEN_KEY);
}

function adminAuthHeaders(): Record<string, string> {
  const token = getAdminToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!token) return headers;
  if (token.includes(".")) {
    headers.Authorization = `Bearer ${token}`;
    headers["x-admin-token"] = token;
  } else {
    headers["x-admin-token"] = token;
  }
  return headers;
}

async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...adminAuthHeaders(),
    ...(init?.headers as Record<string, string> | undefined),
  };
  const res = await fetch(`${API_BASE}${path}`, { ...init, credentials: "include", headers });
  const json = (await res.json().catch(() => ({}))) as ApiEnvelope<T> & { message?: unknown };
  if (!res.ok) {
    throw new ApiError(res.status, normalizeApiMessage(json.message, `HTTP ${res.status}`));
  }
  if (json.code !== 0) {
    throw new ApiError(json.code, normalizeApiMessage(json.message, `code ${json.code}`));
  }
  return json.data;
}

export async function adminLogin(account: string, password: string) {
  const data = await adminRequest<{ token: string; admin: AdminProfile }>("/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ account, password }),
    headers: { "Content-Type": "application/json" },
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

export async function adminStats() {
  return adminRequest<any>("/admin/stats/overview");
}
export async function adminPendingDramas() {
  return adminRequest<any[]>("/admin/dramas/pending");
}
export async function adminApproveDrama(id: string) {
  return adminRequest<any>(`/admin/dramas/${id}/approve`, { method: "POST", body: "{}" });
}
export async function adminRejectDrama(id: string, reason?: string) {
  return adminRequest<any>(`/admin/dramas/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}
export async function adminPendingCreators() {
  return adminRequest<any[]>("/admin/creators/pending");
}
export async function adminApproveKyc(id: string) {
  return adminRequest<any>(`/admin/creators/${id}/kyc/approve`, { method: "POST", body: "{}" });
}
export async function adminPendingWithdraws(overdueHours?: number) {
  const qs =
    overdueHours != null ? `?overdueHours=${encodeURIComponent(String(overdueHours))}` : "";
  return adminRequest<any[]>(`/admin/withdraws/pending${qs}`);
}
export async function adminApproveWithdraw(id: string) {
  return adminRequest<any>(`/admin/withdraws/${id}/approve`, { method: "POST", body: "{}" });
}
export async function adminRejectWithdraw(id: string, reason?: string) {
  return adminRequest<any>(`/admin/withdraws/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}
export async function adminSettleT7(days = 0) {
  return adminRequest<any>(`/admin/settle-t7?days=${days}`, { method: "POST", body: "{}" });
}
export async function adminLocalImport(rootPath?: string, dryRun?: boolean) {
  return adminRequest<any>("/admin/import/local", {
    method: "POST",
    body: JSON.stringify({ rootPath, dryRun }),
  });
}

export async function adminDashboard() {
  return adminRequest<any>("/admin/dashboard/overview");
}
export async function adminListDramas(params: Record<string, string | number | undefined> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== "") qs.set(k, String(v));
  });
  return adminRequest<any>(`/admin/dramas?${qs}`);
}
export async function adminGetDrama(id: string) {
  return adminRequest<any>(`/admin/dramas/${id}`);
}
export async function adminUpdateDrama(id: string, body: Record<string, unknown>) {
  return adminRequest<any>(`/admin/dramas/${id}/update`, { method: "POST", body: JSON.stringify(body) });
}
export async function adminOfflineDrama(id: string, reason: string) {
  return adminRequest<any>(`/admin/dramas/${id}/offline`, { method: "POST", body: JSON.stringify({ reason }) });
}
export async function adminOnlineDrama(id: string, reason: string) {
  return adminRequest<any>(`/admin/dramas/${id}/online`, { method: "POST", body: JSON.stringify({ reason }) });
}
export async function adminSetFeatured(id: string, value: boolean) {
  return adminRequest<any>(`/admin/dramas/${id}/featured`, { method: "POST", body: JSON.stringify({ value }) });
}
export async function adminSetOfficial(id: string, value: boolean) {
  return adminRequest<any>(`/admin/dramas/${id}/official`, { method: "POST", body: JSON.stringify({ value }) });
}
export async function adminSetSortWeight(id: string, weight: number) {
  return adminRequest<any>(`/admin/dramas/${id}/sort-weight`, { method: "POST", body: JSON.stringify({ weight }) });
}
export async function adminDramaRanking() {
  return adminRequest<any>("/admin/dramas/ranking");
}
export async function adminDramaEpisodes(id: string) {
  return adminRequest<any[]>(`/admin/dramas/${id}/episodes`);
}
export async function adminUpdateEpisode(id: string, body: Record<string, unknown>) {
  return adminRequest<any>(`/admin/episodes/${id}/update`, { method: "POST", body: JSON.stringify(body) });
}
export async function adminReorderEpisodes(dramaId: string, ids: string[]) {
  return adminRequest<any>(`/admin/dramas/${dramaId}/episodes/reorder`, {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}
export async function adminRetryTranscode(id: string) {
  return adminRequest<any>(`/admin/episodes/${id}/transcode-retry`, { method: "POST", body: "{}" });
}

export async function adminListBanners(all = true) {
  const data = await adminRequest<any>(`/admin/banners?all=${all ? "1" : "0"}`);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.rows)) return data.rows;
  return [];
}
export async function adminCreateBanner(body: Record<string, unknown>) {
  return adminRequest<any>("/admin/banners", { method: "POST", body: JSON.stringify(body) });
}
export async function adminUpdateBanner(id: string, body: Record<string, unknown>) {
  return adminRequest<any>(`/admin/banners/${id}`, { method: "POST", body: JSON.stringify(body) });
}
export async function adminDeleteBanner(id: string) {
  return adminRequest<any>(`/admin/banners/${id}/delete`, { method: "POST", body: "{}" });
}

export async function adminListCategories(all = true) {
  const data = await adminRequest<any>(`/admin/categories?all=${all ? "1" : "0"}`);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.rows)) return data.rows;
  return [];
}
export async function adminCreateCategory(body: Record<string, unknown>) {
  return adminRequest<any>("/admin/categories", { method: "POST", body: JSON.stringify(body) });
}
export async function adminUpdateCategory(slug: string, body: Record<string, unknown>) {
  return adminRequest<any>(`/admin/categories/${slug}`, { method: "POST", body: JSON.stringify(body) });
}
export async function adminDeleteCategory(slug: string) {
  return adminRequest<any>(`/admin/categories/${slug}/delete`, { method: "POST", body: "{}" });
}

export async function adminListOrders(params: Record<string, string | number | undefined> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== "") qs.set(k, String(v));
  });
  return adminRequest<any>(`/admin/orders?${qs}`);
}
export async function adminMarkPaid(orderNo: string, externalRef: string) {
  return adminRequest<any>(`/admin/orders/${orderNo}/mark-paid`, {
    method: "POST",
    body: JSON.stringify({ externalRef }),
  });
}
export async function adminListRefunds(page = 1, pageSize = 20) {
  return adminRequest<any>(`/admin/refunds/requests?page=${page}&pageSize=${pageSize}`);
}
export async function adminApproveRefund(orderNo: string) {
  return adminRequest<any>(`/admin/refunds/${orderNo}/approve`, { method: "POST", body: "{}" });
}
export async function adminRefuseRefund(orderNo: string, reason: string) {
  return adminRequest<any>(`/admin/refunds/${orderNo}/refuse`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

/** 下载 CSV（非 JSON envelope） */
export async function adminDownloadCsv(
  kind: "orders" | "withdraws" | "reconciliations",
  filename?: string,
) {
  const headers = adminAuthHeaders();
  delete headers["Content-Type"];
  const res = await fetch(`${API_BASE}/admin/exports/${kind}.csv`, {
    credentials: "include",
    headers,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, text || `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || `${kind}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function requestRefund(orderNo: string, note?: string) {
  return request<any>(`/orders/${orderNo}/refund-request`, {
    method: "POST",
    body: JSON.stringify({ note: note || "" }),
  });
}

export async function adminListReconciliations(page = 1, pageSize = 30) {
  return adminRequest<any>(`/admin/reconciliations?page=${page}&pageSize=${pageSize}`);
}
export async function adminRerunReconcile(days = 1) {
  return adminRequest<any>(`/admin/reconciliations/rerun?days=${days}`, { method: "POST", body: "{}" });
}

export async function adminListAuditLogs(params: Record<string, string | number | undefined> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== "") qs.set(k, String(v));
  });
  return adminRequest<any>(`/admin/audit-logs?${qs}`);
}

export async function adminListWithdraws(params: Record<string, string | number | undefined> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== "") qs.set(k, String(v));
  });
  return adminRequest<any>(`/admin/withdraws/list?${qs}`);
}
export async function adminRejectKyc(id: string, reason: string) {
  return adminRequest<any>(`/admin/creators/${id}/kyc/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}
export async function adminListKyc(params: Record<string, string | number | undefined> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== "") qs.set(k, String(v));
  });
  return adminRequest<any>(`/admin/kyc/list?${qs}`);
}

export async function adminListUsers(params: Record<string, string | number | undefined> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== "") qs.set(k, String(v));
  });
  return adminRequest<any>(`/admin/users?${qs}`);
}
export async function adminGetUser(id: string) {
  return adminRequest<any>(`/admin/users/${id}`);
}
export async function adminSetUserStatus(id: string, status: string, reason: string) {
  return adminRequest<any>(`/admin/users/${id}/status`, {
    method: "POST",
    body: JSON.stringify({ status, reason }),
  });
}
export async function adminForceLogout(id: string) {
  return adminRequest<any>(`/admin/users/${id}/force-logout`, { method: "POST", body: "{}" });
}

export async function adminWalletLedger(params: Record<string, string | number | undefined> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== "") qs.set(k, String(v));
  });
  return adminRequest<any>(`/admin/wallet/ledger?${qs}`);
}
export async function adminWalletAdjust(userId: string, deltaCredits: number, reason: string, remark?: string) {
  return adminRequest<any>(`/admin/wallet/adjust?userId=${encodeURIComponent(userId)}`, {
    method: "POST",
    body: JSON.stringify({ deltaCredits, reason, remark }),
  });
}

export async function adminListRates() {
  return adminRequest<any>("/admin/exchange-rates");
}
export async function adminSetRate(body: {
  currency: string;
  cnyToFiat: number;
  sellRate?: number;
}) {
  return adminRequest<any>("/admin/exchange-rates", { method: "POST", body: JSON.stringify(body) });
}

export async function adminListPackages() {
  return adminRequest<any>("/admin/topup-packages");
}
export async function adminCreatePackage(body: {
  name?: string;
  credits: number;
  basePrice: number;
  sortOrder?: number;
  active?: boolean;
}) {
  return adminRequest<any>("/admin/topup-packages", { method: "POST", body: JSON.stringify(body) });
}
export async function adminUpdatePackage(
  id: string,
  body: Partial<{
    name: string;
    credits: number;
    basePrice: number;
    sortOrder: number;
    active: boolean;
  }>,
) {
  return adminRequest<any>(`/admin/topup-packages/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function adminListCreators(params: Record<string, string | number | undefined> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== "") qs.set(k, String(v));
  });
  return adminRequest<any>(`/admin/creators?${qs}`);
}
export async function adminGetCreator(id: string) {
  return adminRequest<any>(`/admin/creators/${id}`);
}

export async function adminListSettings() {
  return adminRequest<any>("/admin/settings");
}
export async function adminUpdateSetting(key: string, value: unknown) {
  return adminRequest<any>("/admin/settings", { method: "POST", body: JSON.stringify({ key, value }) });
}

export async function adminListAdmins() {
  return adminRequest<any[]>("/admin/admins");
}
export async function adminSetAdminRole(id: string, role: "SUPER_ADMIN" | "OPS") {
  return adminRequest<any>(`/admin/admins/${id}/role`, { method: "POST", body: JSON.stringify({ role }) });
}

/** 浏览器选文件夹后 multipart 上传导入（勿设 Content-Type，由浏览器带 boundary） */
export async function adminImportUpload(files: FileList | File[], dryRun: boolean) {
  const list = Array.from(files);
  if (!list.length) throw new ApiError(400, "未选择文件");

  const form = new FormData();
  form.append("dryRun", dryRun ? "true" : "false");
  for (const file of list) {
    form.append("files", file);
    const rel =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    form.append("relativePaths", rel);
  }

  const headers: Record<string, string> = {};
  const token = getAdminToken();
  if (token) {
    if (token.includes(".")) {
      headers.Authorization = `Bearer ${token}`;
      headers["x-admin-token"] = token;
    } else {
      headers["x-admin-token"] = token;
    }
  }

  const res = await fetch(`${API_BASE}/admin/import/upload`, {
    method: "POST",
    credentials: "include",
    headers,
    body: form,
  });
  const json = (await res.json().catch(() => ({}))) as ApiEnvelope<any> & { message?: string };
  if (!res.ok) throw new ApiError(res.status, json.message || `HTTP ${res.status}`);
  if (json.code !== 0) throw new ApiError(json.code, json.message);
  return json.data;
}

export { API_BASE, ApiError };

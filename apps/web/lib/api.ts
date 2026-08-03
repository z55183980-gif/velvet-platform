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
    buyoutCredits: d.buyoutCredits != null ? String(d.buyoutCredits) : null,
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

export async function loadDramaDetail(slug: string): Promise<{
  drama: Drama;
  episodes: Episode[];
  buyoutCredits?: string | null;
  vipActive?: boolean;
  dramaUnlocked?: boolean;
} | null> {
  try {
    const d = await request<any>(`/dramas/${slug}`);
    // 详情里的 episodes 不含 unlocked；再拉一次带用户态的剧集列表
    let episodes = (d.episodes || []).map(mapEpisode);
    let buyoutCredits: string | null = d.buyoutCredits != null ? String(d.buyoutCredits) : null;
    let vipActive = false;
    let dramaUnlocked = false;
    try {
      const eps = await request<{
        rows: any[];
        buyoutCredits?: string | null;
        vipActive?: boolean;
        dramaUnlocked?: boolean;
      }>(`/dramas/${slug}/episodes`);
      if (eps?.rows?.length) episodes = eps.rows.map(mapEpisode);
      if (eps?.buyoutCredits != null) buyoutCredits = String(eps.buyoutCredits);
      vipActive = !!eps?.vipActive;
      dramaUnlocked = !!eps?.dramaUnlocked;
    } catch {
      /* 未登录时仍用详情集列表 */
    }
    const drama = mapDrama(d);
    drama.buyoutCredits = buyoutCredits;
    return { drama, episodes, buyoutCredits, vipActive, dramaUnlocked };
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

export async function vipSubOrder(
  vipPlanId: string | number,
  currency: string,
  paymentMethod = "STRIPE",
) {
  return request<any>("/orders/vip-sub", {
    method: "POST",
    body: JSON.stringify({ vipPlanId, currency, paymentMethod }),
  });
}

export type VipPlanQuote = {
  id: string;
  name: string | null;
  durationDays: number;
  baseCurrency: string;
  basePrice: string;
  badge?: string | null;
  payCurrency?: string;
  payAmount?: string;
  cnyToFiat?: string;
};

export async function getVipPlans(currency = "CNY"): Promise<VipPlanQuote[]> {
  try {
    return await request(`/vip-plans?currency=${encodeURIComponent(currency)}`);
  } catch {
    return [];
  }
}

export async function redeemCode(code: string) {
  return request<any>("/redeem", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function unlockDrama(dramaId: string | number) {
  return request<any>("/orders/unlock-drama", {
    method: "POST",
    body: JSON.stringify({ dramaId }),
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

export async function requestRefund(orderNo: string, note?: string) {
  return request<any>(`/orders/${orderNo}/refund-request`, {
    method: "POST",
    body: JSON.stringify({ note: note || "" }),
  });
}

export { API_BASE, ApiError };

import { ApiError, normalizeApiMessage, type ApiEnvelope } from "../types";

export const ADMIN_TOKEN_KEY = "dv_admin_token";
/** Must stay aligned with apps/admin `LOCALE_STORAGE_KEY` (admin is zh|en only). */
export const ADMIN_LOCALE_STORAGE_KEY = "velvet-admin-locale";
export const API_BASE = "/api/v1";

export type AdminProfile = {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  role?: "SUPER_ADMIN" | "OPS";
};

export type AdminLocale = "zh" | "en";

export function getAdminToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(ADMIN_TOKEN_KEY) || "";
}

function broadcastAdminSession(type: "token-changed" | "logout") {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
  try {
    const bc = new BroadcastChannel("velvet-admin-session");
    bc.postMessage({ type });
    bc.close();
  } catch {
    /* ignore */
  }
}

export function setAdminToken(token: string) {
  if (typeof window !== "undefined") {
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
    broadcastAdminSession("token-changed");
  }
}

export function clearAdminToken() {
  if (typeof window !== "undefined") {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    broadcastAdminSession("logout");
  }
}

/** Admin UI is bilingual zh/en only — never fall back to browser language (often vi). */
export function getAdminLocale(): AdminLocale {
  if (typeof window === "undefined") return "zh";
  try {
    return localStorage.getItem(ADMIN_LOCALE_STORAGE_KEY) === "en" ? "en" : "zh";
  } catch {
    return "zh";
  }
}

function adminAuthHeaders(): Record<string, string> {
  const token = getAdminToken();
  const locale = getAdminLocale();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Prefer UI locale over browser Accept-Language so API errors match admin zh/en.
    "Accept-Language": locale === "en" ? "en" : "zh",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function adminRequest<T = any>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...adminAuthHeaders(),
    ...(init?.headers as Record<string, string> | undefined),
  };
  // FormData must not force Content-Type
  if (init?.body instanceof FormData) {
    delete headers["Content-Type"];
  }
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

export async function adminDownloadBlob(
  path: string,
  filename: string,
  init?: RequestInit,
) {
  const token = getAdminToken();
  const locale = getAdminLocale();
  const headers: Record<string, string> = {
    "Accept-Language": locale === "en" ? "en" : "zh",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (init?.body && !(init.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
    headers,
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const json = (await res.json()) as { message?: unknown };
      message = normalizeApiMessage(json.message, message);
    } catch {
      const text = await res.text().catch(() => "");
      if (text.trim()) message = text.slice(0, 300);
    }
    throw new ApiError(res.status, message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

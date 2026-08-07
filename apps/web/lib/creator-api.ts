import { API_BASE, ApiError } from "@/lib/api";
import { formatApiError } from "@/components/toast";

export async function creatorApi<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("dv_token");
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}/creator${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.code !== 0) {
    throw new ApiError(
      res.status || json.code || 500,
      formatApiError({ message: json.message }, `HTTP ${res.status}`),
    );
  }
  return json.data as T;
}

export async function creatorUploadVideo(file: File): Promise<{ relativePath: string }> {
  const headers: Record<string, string> = {};
  const token = typeof window !== "undefined" ? localStorage.getItem("dv_token") : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${API_BASE}/creator/upload`, {
    method: "POST",
    credentials: "include",
    headers,
    body: fd,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.code !== 0) {
    throw new ApiError(res.status || 500, json.message || "upload fail");
  }
  return { relativePath: String(json.data?.relativePath || "") };
}

export async function creatorUploadKycDoc(
  file: File,
  kind: "cccd-front" | "cccd-back",
): Promise<{ relativePath: string; originalUrl: string }> {
  const headers: Record<string, string> = {};
  const token = typeof window !== "undefined" ? localStorage.getItem("dv_token") : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  const fd = new FormData();
  fd.append("file", file);
  fd.append("kind", kind);
  const res = await fetch(`${API_BASE}/creator/kyc-doc`, {
    method: "POST",
    credentials: "include",
    headers,
    body: fd,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.code !== 0) {
    throw new ApiError(res.status || 500, json.message || "upload fail");
  }
  const relativePath = String(json.data?.relativePath || "");
  // Prefer relative docs/ path for KYC persistence (API re-signs on admin read).
  const originalUrl = relativePath || String(json.data?.originalUrl || "");
  return { relativePath, originalUrl };
}

export type ApiEnvelope<T> = {
  code: number;
  message: string;
  data: T;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Retry delay advertised by the server (for example HTTP Retry-After). */
    public retryAfterMs?: number,
  ) {
    super(typeof message === "string" ? message : String(message ?? `HTTP ${status}`));
    this.name = "ApiError";
  }
}

export function normalizeApiMessage(message: unknown, fallback: string): string {
  if (typeof message === "string" && message.trim()) return message;
  if (Array.isArray(message)) {
    const parts = message
      .map((m) => {
        if (typeof m === "string") return m;
        if (m && typeof m === "object" && "constraints" in (m as object)) {
          return Object.values((m as { constraints: Record<string, string> }).constraints).join(
            ", ",
          );
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

export type Paginated<T> = {
  items?: T[];
  rows?: T[];
  total?: number;
  page?: number;
  pageSize?: number;
};

export function asRows<T>(data: Paginated<T> | T[] | null | undefined): T[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.rows)) return data.rows;
  return [];
}

export function toQuery(params: Record<string, string | number | boolean | undefined | null> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== "") qs.set(k, String(v));
  });
  const s = qs.toString();
  return s ? `?${s}` : "";
}

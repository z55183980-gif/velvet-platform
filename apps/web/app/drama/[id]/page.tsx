import { notFound } from "next/navigation";
import { DramaDetail } from "@/components/drama-detail";

async function liveDramaExists(id: string): Promise<"yes" | "no" | "unknown"> {
  const base = (process.env.API_PROXY_TARGET || "http://127.0.0.1:4100").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/api/v1/dramas/${encodeURIComponent(id)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 404) return "no";
    if (!res.ok) return "unknown";
    const json = (await res.json().catch(() => null)) as {
      code?: number;
      data?: unknown;
    } | null;
    if (!json || json.code !== 0 || !json.data) return "no";
    return "yes";
  } catch {
    // API unreachable — let the client shell try (avoid site-wide hard 404).
    return "unknown";
  }
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lfs?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const exists = await liveDramaExists(id);
  if (exists === "no") notFound();
  return <DramaDetail id={id} autoLandscapeFs={sp.lfs === "1"} />;
}

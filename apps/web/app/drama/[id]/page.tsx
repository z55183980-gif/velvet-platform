import { notFound } from "next/navigation";
import { DramaDetail } from "@/components/drama-detail";

async function liveDramaExists(id: string): Promise<boolean> {
  const base = (process.env.API_PROXY_TARGET || "http://127.0.0.1:4100").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/api/v1/dramas/${encodeURIComponent(id)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 404) return false;
    if (!res.ok) return false;
    const json = (await res.json().catch(() => null)) as {
      code?: number;
      data?: unknown;
    } | null;
    return !!json && json.code === 0 && !!json.data;
  } catch {
    // API unreachable — fail closed (prefer 404 over soft-200 shell).
    return false;
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

  if (!(await liveDramaExists(id))) {
    return notFound();
  }

  return <DramaDetail id={id} autoLandscapeFs={sp.lfs === "1"} />;
}

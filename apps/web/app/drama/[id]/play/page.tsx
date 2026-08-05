import { notFound } from "next/navigation";
import { DramaDetail } from "@/components/drama-detail";
import { liveDramaPageOk } from "@/lib/live-drama-page";

/** Direct watch entry (Feed episode bar / fullscreen / detail CTA). */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lfs?: string; ep?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  if (!(await liveDramaPageOk(id))) {
    return notFound();
  }

  const epNo = sp.ep && /^\d+$/.test(sp.ep) ? Number(sp.ep) : undefined;

  return (
    <DramaDetail
      id={id}
      autoStartWatch
      autoLandscapeFs={sp.lfs === "1"}
      initialEpisodeNo={epNo}
    />
  );
}

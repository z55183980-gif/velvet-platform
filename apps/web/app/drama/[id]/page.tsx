import { notFound } from "next/navigation";
import { DramaDetail } from "@/components/drama-detail";
import { liveDramaPageOk } from "@/lib/live-drama-page";

/** Hongguo browse landing — never auto-starts playback. */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!(await liveDramaPageOk(id))) {
    return notFound();
  }

  return <DramaDetail id={id} />;
}

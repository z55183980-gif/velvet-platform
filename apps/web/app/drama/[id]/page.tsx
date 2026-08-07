import { notFound } from "next/navigation";
import { DramaDetail } from "@/components/drama-detail";
import { liveDramaPageOk } from "@/lib/live-drama-page";

/**
 * Drama entry: PC opens the theater shell directly (player + sidebar).
 * Mobile keeps the browse landing; playback uses `/drama/[id]/play`.
 */
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

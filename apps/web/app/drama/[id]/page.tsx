import { DramaDetail } from "@/components/drama-detail";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lfs?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  return <DramaDetail id={id} autoLandscapeFs={sp.lfs === "1"} />;
}

import { TheaterClient } from "@/components/theater-client";
import { loadTheaterInitial } from "@/lib/theater-ssr";

export default async function SecretPage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    tag?: string;
    cat?: string;
    sort?: string;
    q?: string;
  }>;
}) {
  const sp = await searchParams;
  const initial = await loadTheaterInitial(sp, { secret: true });
  return <TheaterClient initial={initial} secretOnly />;
}

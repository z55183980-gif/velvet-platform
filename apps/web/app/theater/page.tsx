import { TheaterClient } from "@/components/theater-client";
import { loadTheaterInitial } from "@/lib/theater-ssr";

/**
 * Theater: SSR first page (+ categories) so PC first paint is real posters, not a skeleton shell.
 * Soft-nav restore + infinite scroll live in TheaterClient.
 */
export default async function TheaterPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; sort?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const initial = await loadTheaterInitial(sp);
  return <TheaterClient initial={initial} />;
}

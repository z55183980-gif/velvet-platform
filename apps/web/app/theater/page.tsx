import { TheaterClient } from "@/components/theater-client";
import { loadTheaterInitial } from "@/lib/theater-ssr";

/**
 * Theater: SSR first page so PC first paint is real posters, not a skeleton shell.
 * Soft-nav restore + infinite scroll live in TheaterClient.
 * Row 1: All + content forms. Row 2: Filter / Charts / New.
 */
export default async function TheaterPage({
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
  const initial = await loadTheaterInitial(sp);
  return <TheaterClient initial={initial} />;
}

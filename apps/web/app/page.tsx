import { headers } from "next/headers";
import { HomeClient } from "@/components/home-client";
import {
  likelyMobileUserAgent,
  loadHomeDesktopInitial,
} from "@/lib/home-ssr";

/**
 * Home: SSR the default PC grid so first paint is real content, not a skeleton shell.
 * Filtered/mobile stay client-fetched (mobile uses VerticalFeed).
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; q?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const filtered = !!(sp.cat || sp.q || sp.sort);
  const ua = (await headers()).get("user-agent") || "";
  const skipDesktopSsr = filtered || likelyMobileUserAgent(ua);

  const initialUnfiltered = skipDesktopSsr
    ? null
    : await loadHomeDesktopInitial();

  return <HomeClient initialUnfiltered={initialUnfiltered} />;
}

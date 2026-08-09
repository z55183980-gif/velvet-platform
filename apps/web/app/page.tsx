import { headers } from "next/headers";
import { HomeClient } from "@/components/home-client";
import {
  likelyMobileUserAgent,
  loadHomeDesktopInitial,
  loadHomeMobileFeedInitial,
} from "@/lib/home-ssr";

/**
 * Home: SSR real content for first paint.
 * - Desktop: banners + Popular dramas grid
 * - Mobile UA: VerticalFeed page 1 (skip desktop grid SSR)
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; q?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const filtered = !!(sp.cat || sp.q || sp.sort);
  const ua = (await headers()).get("user-agent") || "";
  const preferMobileFeed = !filtered && likelyMobileUserAgent(ua);

  const [initialUnfiltered, initialMobileFeed] = await Promise.all([
    filtered || preferMobileFeed ? Promise.resolve(null) : loadHomeDesktopInitial(),
    preferMobileFeed ? loadHomeMobileFeedInitial() : Promise.resolve(null),
  ]);

  return (
    <HomeClient
      initialUnfiltered={initialUnfiltered}
      initialMobileFeed={initialMobileFeed}
      preferMobileFeed={preferMobileFeed}
    />
  );
}

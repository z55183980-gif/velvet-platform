import type { Metadata } from "next";
import { WEB_ORIGIN } from "@/lib/site";
import { RedirectToPlayback } from "./redirect-to-playback";

const PREVIEW_IMAGE = "/covers/telegram-preview-test.png";
const INVISIBLE_SEPARATOR = "\u2063";

export const metadata: Metadata = {
  metadataBase: new URL(WEB_ORIGIN),
  title: { absolute: INVISIBLE_SEPARATOR },
  description: INVISIBLE_SEPARATOR,
  robots: { index: false, follow: false },
  openGraph: {
    type: "website",
    title: INVISIBLE_SEPARATOR,
    description: INVISIBLE_SEPARATOR,
    siteName: INVISIBLE_SEPARATOR,
    images: [
      {
        url: PREVIEW_IMAGE,
        width: 568,
        height: 516,
        alt: "▶ 播放",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: INVISIBLE_SEPARATOR,
    description: INVISIBLE_SEPARATOR,
    images: [PREVIEW_IMAGE],
  },
};

function safeDramaSlug(value: string | undefined): string {
  const fallback = "betraying-my-billionaire-husband";
  const slug = String(value || fallback).trim();
  return /^[A-Za-z0-9_-]{1,100}$/.test(slug) ? slug : fallback;
}

function safeEpisode(value: string | undefined): number {
  const episode = Number(value);
  return Number.isInteger(episode) && episode > 0 && episode <= 100_000 ? episode : 1;
}

export default async function TelegramPreviewTestPage({
  searchParams,
}: {
  searchParams: Promise<{ drama?: string; ep?: string }>;
}) {
  const params = await searchParams;
  const drama = safeDramaSlug(params.drama);
  const episode = safeEpisode(params.ep);
  const playbackHref = `/drama/${encodeURIComponent(drama)}/play?ep=${episode}`;

  return <RedirectToPlayback href={playbackHref} />;
}

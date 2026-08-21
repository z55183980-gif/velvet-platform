import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WEB_ORIGIN } from "@/lib/site";
import { RedirectToPlayback } from "@/app/tg-preview/test/redirect-to-playback";

const PREVIEW_IMAGE = "/covers/telegram-preview-test.png";
const PREVIEW_TITLE = "▶ 点击播放";
const PREVIEW_DESCRIPTION = "打开剧集播放";

type ShortLinkTarget = {
  drama: string;
  episode: number;
};

/** First-party short links. Add one entry per shareable drama/episode. */
const SHORT_LINKS: Record<string, ShortLinkTarget> = {
  a7K3: {
    drama: "betraying-my-billionaire-husband",
    episode: 1,
  },
};

function getTarget(code: string): ShortLinkTarget | null {
  return SHORT_LINKS[String(code || "").trim()] || null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const target = getTarget(code);
  if (!target) return {};

  return {
    metadataBase: new URL(WEB_ORIGIN),
    title: { absolute: PREVIEW_TITLE },
    description: PREVIEW_DESCRIPTION,
    robots: { index: false, follow: false },
    openGraph: {
      type: "article",
      url: `/p/${encodeURIComponent(code)}`,
      title: PREVIEW_TITLE,
      description: PREVIEW_DESCRIPTION,
      siteName: "Velvet",
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
      title: PREVIEW_TITLE,
      description: PREVIEW_DESCRIPTION,
      images: [PREVIEW_IMAGE],
    },
  };
}

export default async function ShortLinkPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const target = getTarget(code);
  if (!target) notFound();

  const href = `/drama/${encodeURIComponent(target.drama)}/play?ep=${target.episode}`;
  return <RedirectToPlayback href={href} />;
}

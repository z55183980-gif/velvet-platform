"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n";
import { useAuth } from "@/components/auth-context";
import { VerticalPlayer } from "@/components/mobile/vertical-player";
import { getPlayUrl, loadDramaDetail, type DramaDetailPayload } from "@/lib/api";
import type { Drama, Episode } from "@/lib/mock-data";
import { pickContentText } from "@/lib/languages";
import { formatCredits } from "@/lib/utils";

function isUrl(s: string) {
  return /^https?:\/\//.test(s) || s.startsWith("/");
}

function isHls(url: string) {
  return /\.m3u8(\?|$)/i.test(url);
}

type FeedEntry = {
  detail: DramaDetailPayload;
  episode: Episode | null;
};

const detailCache = new Map<string, FeedEntry>();

function pickEpisode(detail: DramaDetailPayload): Episode | null {
  return detail.episodes.find((e) => e.isFree || e.unlocked) ?? detail.episodes[0] ?? null;
}

async function ensureDetail(dramaId: string, signal?: AbortSignal): Promise<FeedEntry | null> {
  const hit = detailCache.get(dramaId);
  if (hit) return hit;
  const detail = await loadDramaDetail(dramaId, { signal });
  if (!detail) return null;
  const entry: FeedEntry = { detail, episode: pickEpisode(detail) };
  detailCache.set(dramaId, entry);
  return entry;
}

export function VerticalFeed({ dramas }: { dramas: Drama[] }) {
  const { locale, t } = useLocale();
  const { user, ready: authReady, openLogin } = useAuth();
  const [index, setIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [playErr, setPlayErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const touchY = useRef<number | null>(null);

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => Math.max(0, Math.min(dramas.length - 1, i + delta)));
    },
    [dramas.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "PageDown") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const drama = dramas[index] ?? null;

  // Load current + prefetch neighbors
  useEffect(() => {
    if (!drama) return;
    const ac = new AbortController();
    const cached = detailCache.get(drama.id);
    if (cached) {
      setEpisode(cached.episode);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setPlayErr(null);

    void ensureDetail(drama.id, ac.signal)
      .then((entry) => {
        if (ac.signal.aborted || !entry) return;
        setEpisode(entry.episode);
        setLoading(false);
      })
      .catch(() => {
        if (!ac.signal.aborted) setLoading(false);
      });

    // Prefetch ±1
    const prevId = dramas[index - 1]?.id;
    const nextId = dramas[index + 1]?.id;
    for (const id of [prevId, nextId]) {
      if (id && !detailCache.has(id)) {
        void ensureDetail(id).catch(() => {});
      }
    }

    return () => ac.abort();
  }, [drama?.id, index, dramas]);

  useEffect(() => {
    if (!episode || !(episode.isFree || episode.unlocked)) {
      setPlayUrl(null);
      return;
    }
    if (!authReady || !user) {
      setPlayUrl(null);
      return;
    }
    const ac = new AbortController();
    // Keep previous frame while next URL loads — only show spinner if no url yet
    if (!playUrl) setLoading(true);
    setPlayErr(null);
    getPlayUrl(String(episode.id), { signal: ac.signal })
      .then((r) => {
        if (ac.signal.aborted) return;
        setPlayUrl(r.playUrl);
        setLoading(false);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setPlayErr(e?.message || t("player.error"));
        setLoading(false);
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode?.id, episode?.isFree, episode?.unlocked, authReady, user]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playUrl) return;

    if (!isHls(playUrl)) {
      video.src = playUrl;
      return;
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = playUrl;
      return;
    }

    let cancelled = false;
    let hls: { destroy: () => void; loadSource: (u: string) => void; attachMedia: (v: HTMLVideoElement) => void } | null =
      null;
    (async () => {
      try {
        const mod = await import("hls.js");
        const Hls = mod.default;
        if (cancelled || !Hls.isSupported()) return;
        hls = new Hls();
        hls.loadSource(playUrl);
        hls.attachMedia(video);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [playUrl]);

  // Clear play URL when drama index changes (new item)
  useEffect(() => {
    setPlayUrl(null);
  }, [drama?.id]);

  if (dramas.length === 0) {
    return (
      <div className="flex h-[calc(100dvh-3rem-3.5rem)] items-center justify-center text-ink-muted">
        {t("theater.empty")}
      </div>
    );
  }

  if (!drama) return null;

  const title = pickContentText(locale, drama.titleVi, drama.titleZh);
  const unlocked = !!(episode && (episode.isFree || episode.unlocked));
  const needsLogin = authReady && unlocked && !user;
  const locked = !!episode && !unlocked;
  const cover = isUrl(drama.cover[0]) ? drama.cover[0] : undefined;

  return (
    <div
      className="relative h-[calc(100dvh-3rem-3.5rem-env(safe-area-inset-bottom))] overflow-hidden bg-black"
      onTouchStart={(e) => {
        touchY.current = e.touches[0]?.clientY ?? null;
      }}
      onTouchEnd={(e) => {
        if (touchY.current == null) return;
        const dy = (e.changedTouches[0]?.clientY ?? touchY.current) - touchY.current;
        touchY.current = null;
        if (Math.abs(dy) < 56) return;
        go(dy < 0 ? 1 : -1);
      }}
      onWheel={(e) => {
        if (Math.abs(e.deltaY) < 40) return;
        go(e.deltaY > 0 ? 1 : -1);
      }}
    >
      <VerticalPlayer
        key={drama.id}
        videoRef={videoRef}
        active
        src={playUrl && unlocked && user ? playUrl : null}
        poster={cover}
        autoPlay
        muted={muted}
        onMutedChange={setMuted}
        loginRequired={needsLogin}
        onLogin={() => openLogin()}
        locked={locked}
        lockLabel={
          locked && episode
            ? `${t("detail.unlockEpisode")} · ${formatCredits(episode.price, t("card.credits"))}`
            : undefined
        }
        lockActionLabel={t("feed.watch")}
        onUnlock={undefined}
        error={playErr}
        loading={loading}
        title={title}
        subtitle={t("feed.episodes", { n: drama.episodesCount })}
        onEnded={() => go(1)}
      />

      <Link
        href={`/drama/${drama.id}`}
        className="absolute bottom-20 right-4 z-30 rounded-full bg-brand px-4 py-2.5 text-body-sm font-medium text-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {t("feed.watch")}
      </Link>

      {index < dramas.length - 1 && (
        <p className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full bg-black/35 px-3 py-1 text-caption text-white/80 backdrop-blur">
          {t("feed.swipeHint")}
        </p>
      )}
    </div>
  );
}

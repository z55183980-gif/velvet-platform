"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Star, Play, ChevronLeft, ListVideo } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { useAuth } from "@/components/auth-context";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EpisodeList } from "@/components/episode-list";
import { UnlockSheet } from "@/components/unlock-sheet";
import { VideoPlayer } from "@/components/video-player";
import { VerticalPlayer } from "@/components/mobile/vertical-player";
import { EpisodeDrawer } from "@/components/mobile/episode-drawer";
import { useIsMobile } from "@/hooks/use-is-mobile";
import {
  loadDramaDetail,
  getPlayUrl,
  addFavorite,
  removeFavorite,
  getFavorites,
  getWatchHistory,
  unlockDrama,
} from "@/lib/api";
import { categoryName, type Drama, type Episode } from "@/lib/mock-data";
import { pickContentText } from "@/lib/languages";
import { formatCredits, mediaUrl } from "@/lib/utils";

function isUrl(s: string) {
  return /^https?:\/\//.test(s) || s.startsWith("/");
}

function isHls(url: string) {
  return /\.m3u8(\?|$)/i.test(url);
}

export function DramaDetail({ id }: { id: string }) {
  const { locale, t } = useLocale();
  const { user, unlock, openLogin, ready: authReady } = useAuth();
  const isMobile = useIsMobile();
  const [data, setData] = useState<{
    drama: Drama;
    episodes: Episode[];
    buyoutCredits?: string | null;
    vipActive?: boolean;
    dramaUnlocked?: boolean;
  } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [unlockedNos, setUnlockedNos] = useState<Set<number>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetEp, setSheetEp] = useState<Episode | null>(null);
  const [selected, setSelected] = useState<Episode | null>(null);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [playErr, setPlayErr] = useState<string | null>(null);
  const [favorited, setFavorited] = useState(false);
  const [favBusy, setFavBusy] = useState(false);
  const [resumeHint, setResumeHint] = useState<{ epNo: number; progressSec: number } | null>(null);
  const [seekTo, setSeekTo] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const resumeApplied = useRef(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadDramaDetail(id)
      .then((d) => {
        if (!alive) return;
        if (d) {
          setData(d);
          const nos = new Set(d.episodes.filter((e) => e.isFree || e.unlocked).map((e) => e.no));
          setUnlockedNos(nos);
        } else setNotFound(true);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    if (!user || !data?.drama.numericId) {
      setFavorited(false);
      return;
    }
    let alive = true;
    getFavorites(1)
      .then((r) => {
        if (!alive) return;
        const nid = data.drama.numericId;
        setFavorited(
          (r?.rows || []).some(
            (row: any) => String(row.dramaId ?? row.drama?.id) === String(nid),
          ),
        );
      })
      .catch(() => alive && setFavorited(false));
    return () => {
      alive = false;
    };
  }, [user, data?.drama.numericId]);

  useEffect(() => {
    if (data && !selected) {
      const freeOrUnlocked = data.episodes.find((e) => e.isFree || e.unlocked) ?? null;
      setSelected(freeOrUnlocked);
    }
  }, [data, selected]);

  useEffect(() => {
    if (!user || !data) return;
    let alive = true;
    resumeApplied.current = false;
    getWatchHistory(1, data.drama.numericId || data.drama.id)
      .then((r) => {
        if (!alive) return;
        const row = r?.rows?.[0];
        if (!row?.episode?.episodeNumber) return;
        const epNo = row.episode.episodeNumber as number;
        const progressSec = Number(row.progressSec || 0);
        setResumeHint({ epNo, progressSec });
        const ep = data.episodes.find((e) => e.no === epNo);
        if (ep && (ep.isFree || ep.unlocked || unlockedNos.has(ep.no))) {
          setSelected(ep);
          if (progressSec > 5) setSeekTo(progressSec);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [user, data?.drama.numericId, data?.drama.id]);

  const toggleFavorite = async () => {
    if (!user) {
      openLogin();
      return;
    }
    const nid = data?.drama.numericId;
    if (!nid || favBusy) return;
    setFavBusy(true);
    try {
      if (favorited) {
        await removeFavorite(nid);
        setFavorited(false);
      } else {
        await addFavorite(nid);
        setFavorited(true);
      }
    } catch {
      /* ignore */
    } finally {
      setFavBusy(false);
    }
  };

  const isUnlocked = (ep: Episode) =>
    ep.isFree || !!ep.unlocked || unlockedNos.has(ep.no) || !!data?.vipActive || !!data?.dramaUnlocked || !!user?.isVip;
  const playerReady = !!(selected && isUnlocked(selected));
  const vipPass = !!(data?.vipActive || user?.isVip);
  const lockActionLabel =
    selected && !selected.isFree && !isUnlocked(selected)
      ? vipPass
        ? t("vip.freeWatch")
        : `${t("detail.unlockEpisode")} · ${formatCredits(selected.price, t("card.credits"))}`
      : undefined;

  useEffect(() => {
    if (!playerReady || !selected?.id) {
      setPlayUrl(null);
      setPlayErr(null);
      return;
    }
    if (!authReady) {
      setPlayUrl(null);
      setPlayErr(null);
      return;
    }
    if (!user) {
      setPlayUrl(null);
      setPlayErr(null);
      return;
    }
    let alive = true;
    setPlayUrl(null);
    setPlayErr(null);
    getPlayUrl(String(selected.id))
      .then((r) => alive && setPlayUrl(r.playUrl))
      .catch((e) => {
        if (!alive) return;
        if (e?.status === 401) setPlayErr(t("errors.loginRequired"));
        else setPlayErr(e?.message || t("player.error"));
      });
    return () => {
      alive = false;
    };
  }, [playerReady, selected?.id, user, authReady, locale]);

  // HLS attach
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playUrl || !playerReady || !user) return;

    const onMeta = () => {
      if (seekTo != null && seekTo > 5 && !resumeApplied.current) {
        try {
          video.currentTime = seekTo;
          resumeApplied.current = true;
        } catch {
          /* ignore */
        }
      }
    };
    video.addEventListener("loadedmetadata", onMeta);

    if (!isHls(playUrl)) {
      video.src = playUrl;
      return () => video.removeEventListener("loadedmetadata", onMeta);
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = playUrl;
      return () => video.removeEventListener("loadedmetadata", onMeta);
    }
    let hls: any;
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("hls.js");
        const Hls = mod.default;
        if (cancelled || !Hls.isSupported()) {
          if (!cancelled) setPlayErr("Trình duyệt không hỗ trợ HLS");
          return;
        }
        hls = new Hls();
        hls.loadSource(playUrl);
        hls.attachMedia(video);
      } catch {
        if (!cancelled) setPlayErr("Không tải được trình phát HLS");
      }
    })();
    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", onMeta);
      if (hls) hls.destroy();
    };
  }, [playUrl, seekTo, playerReady, user]);

  if (loading) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-24 text-center text-ink-subtle md:px-6">
        {t("common.loading")}
      </div>
    );
  }
  if (notFound || !data) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-24 text-center text-h3 text-ink-muted md:px-6">
        {t("errors.notFoundDrama")}
      </div>
    );
  }

  const { drama } = data;
  const title = pickContentText(locale, drama.titleVi, drama.titleZh);
  const desc = pickContentText(locale, drama.descVi, drama.descZh);
  const cat = categoryName(drama.categorySlug, locale);
  const coverIsImg = isUrl(drama.cover[0]);

  function openUnlock(ep: Episode) {
    if (!authReady) return;
    if (!user) {
      openLogin();
      return;
    }
    setSheetEp(ep);
    setSheetOpen(true);
  }
  async function onConfirmed(ep: Episode) {
    const r = await unlock(ep.id ?? ep.no);
    if (r.ok || r.alreadyUnlocked || r.error === "mock") {
      setUnlockedNos((prev) => new Set(prev).add(ep.no));
      setData((prev) =>
        prev
          ? {
              ...prev,
              episodes: prev.episodes.map((e) =>
                e.no === ep.no ? { ...e, unlocked: true } : e,
              ),
            }
          : prev,
      );
      setSelected(ep);
    }
    return r;
  }

  async function onBuyDrama() {
    const nid = data?.drama.numericId;
    if (!nid) return { ok: false, error: "no drama" };
    try {
      await unlockDrama(nid);
      setUnlockedNos(new Set(data!.episodes.map((e) => e.no)));
      setData((prev) =>
        prev
          ? {
              ...prev,
              dramaUnlocked: true,
              episodes: prev.episodes.map((e) => ({ ...e, unlocked: true })),
            }
          : prev,
      );
      return { ok: true };
    } catch (e: any) {
      return {
        ok: false,
        error: e?.message || "fail",
        code: typeof e?.status === "number" ? e.status : undefined,
      };
    }
  }

  function onWatchFree() {
    if (!user) {
      openLogin();
      return;
    }
    const f = data!.episodes.find((e) => e.isFree || e.unlocked);
    if (f) setSelected(f);
  }

  function playNext() {
    if (!selected || !data) return;
    const idx = data.episodes.findIndex((e) => e.no === selected.no);
    for (let i = idx + 1; i < data.episodes.length; i++) {
      const ep = data.episodes[i];
      if (isUnlocked(ep)) {
        if (!user) openLogin();
        else setSelected(ep);
        return;
      }
    }
  }

  const hasNext = (() => {
    if (!selected || !data) return false;
    const idx = data.episodes.findIndex((e) => e.no === selected.no);
    return data.episodes.slice(idx + 1).some((e) => isUnlocked(e));
  })();

  // session 未就绪时不要误显示「请登录」（V3-01）
  const needsLogin = authReady && playerReady && !user;
  const locked = !playerReady;
  const playLoading = !authReady || (playerReady && !!user && !playUrl && !playErr);

  const selectEpisode = (ep: Episode) => {
    if (isUnlocked(ep)) {
      if (!user) openLogin();
      else {
        setSelected(ep);
        setDrawerOpen(false);
      }
    } else openUnlock(ep);
  };

  if (isMobile) {
    return (
      <div className="relative h-dvh overflow-hidden bg-black">
        <div className="absolute left-0 right-0 top-0 z-30 flex items-center justify-between px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
          <Link
            href="/"
            className="grid h-10 w-10 place-items-center rounded-full bg-black/40 text-white backdrop-blur"
            aria-label="back"
          >
            <ChevronLeft className="h-6 w-6" />
          </Link>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-2 text-body-sm text-white backdrop-blur"
          >
            <ListVideo className="h-4 w-4" />
            {selected ? `${selected.no}/${drama.episodesCount}` : t("detail.episodeList")}
          </button>
        </div>

        <VerticalPlayer
          videoRef={videoRef}
          active
          src={playerReady && user && playUrl ? playUrl : null}
          poster={coverIsImg ? drama.cover[0] : undefined}
          autoPlay
          muted={muted}
          onMutedChange={setMuted}
          seekTo={resumeApplied.current ? null : seekTo}
          loginRequired={needsLogin}
          onLogin={() => openLogin()}
          locked={locked}
          lockLabel={
            selected
              ? `${t("detail.episodeList")} ${selected.no}`
              : t("player.empty")
          }
          lockActionLabel={lockActionLabel}
          onUnlock={selected && !isUnlocked(selected) ? () => openUnlock(selected) : undefined}
          error={playErr}
          loading={playLoading}
          title={title}
          subtitle={selected ? `${t("detail.episodeList")} ${selected.no}` : cat}
          onOpenEpisodes={() => setDrawerOpen(true)}
          onEnded={playNext}
        />

        <EpisodeDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          episodes={data.episodes}
          episodesCount={drama.episodesCount}
          selectedNo={selected?.no}
          isUnlocked={isUnlocked}
          onUnlock={openUnlock}
          onSelect={selectEpisode}
        />

        <UnlockSheet
          open={sheetOpen}
          episode={sheetEp}
          onClose={() => setSheetOpen(false)}
          onConfirmed={onConfirmed}
          buyoutCredits={
            data?.dramaUnlocked
              ? null
              : data?.buyoutCredits
                ? Number(data.buyoutCredits)
                : null
          }
          onBuyDrama={onBuyDrama}
          vipActive={!!data?.vipActive || !!user?.isVip}
        />
      </div>
    );
  }

  return (
    <div className="pb-16 md:pb-24">
      {/* Player-first billboard */}
      <div className="relative bg-black">
        <div className="mx-auto max-w-[1200px]">
          <VideoPlayer
            videoRef={videoRef}
            src={playerReady && user && playUrl ? playUrl : null}
            poster={coverIsImg ? drama.cover[0] : undefined}
            autoPlay
            seekTo={resumeApplied.current ? null : seekTo}
            loginRequired={needsLogin}
            onLogin={() => openLogin()}
            locked={locked}
            lockLabel={
              selected
                ? `${t("detail.episodeList")} ${selected.no}`
                : t("player.empty")
            }
            lockActionLabel={lockActionLabel}
            onUnlock={selected && !isUnlocked(selected) ? () => openUnlock(selected) : undefined}
            error={playErr}
            loading={playLoading}
            hasNext={hasNext}
            onNext={playNext}
            onEnded={playNext}
          />
        </div>
      </div>

      <div className="mx-auto max-w-[1200px] px-4 pt-8 md:px-6 md:pt-10">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="default">{cat}</Badge>
              <span className="inline-flex items-center gap-1 text-body-sm text-ink-muted">
                <Star className="h-4 w-4 fill-gold text-gold" />
                {drama.rating > 0 ? drama.rating.toFixed(1) : "—"}
              </span>
              <span className="text-body-sm text-ink-subtle">{drama.year}</span>
              {selected && (
                <span className="text-body-sm text-brand">
                  {t("detail.episodeList")} {selected.no}
                </span>
              )}
            </div>
            <h1 className="mt-3 text-h2 font-bold text-ink md:text-h1">{title}</h1>
            {resumeHint && resumeHint.progressSec > 5 && (
              <p className="mt-2 text-caption text-ink-subtle">
                {t("detail.resumeHint", {
                  n: resumeHint.epNo,
                  time: `${Math.floor(resumeHint.progressSec / 60)}:${String(resumeHint.progressSec % 60).padStart(2, "0")}`,
                })}
              </p>
            )}
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                className={buttonVariants({ variant: "primary", size: "lg" })}
                onClick={onWatchFree}
              >
                <Play className="h-4 w-4" /> {t("detail.watchFree")}
              </button>
              <button
                className={buttonVariants({ variant: "secondary", size: "lg" })}
                onClick={toggleFavorite}
                disabled={favBusy}
              >
                <Star className={`h-4 w-4 ${favorited ? "fill-gold text-gold" : ""}`} />
                {favorited ? t("detail.favorited") : t("detail.favorite")}
              </button>
            </div>
          </div>

          {drama.creator?.displayName && (
            <div className="flex items-center gap-2.5">
              <div className="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-surface-2 text-caption font-semibold text-ink-muted">
                {mediaUrl(drama.creator.avatarUrl) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mediaUrl(drama.creator.avatarUrl)!}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  drama.creator.displayName.slice(0, 1).toUpperCase()
                )}
              </div>
              <span className="text-body-sm text-ink-muted">{drama.creator.displayName}</span>
            </div>
          )}
        </div>

        <p className="mt-8 max-w-3xl text-body text-ink-muted">{desc}</p>

        <div className="mt-12 md:mt-16">
          <EpisodeList
            episodes={data.episodes}
            episodesCount={drama.episodesCount}
            selectedNo={selected?.no}
            layout="rail"
            isUnlocked={isUnlocked}
            onUnlock={openUnlock}
            onSelect={selectEpisode}
          />
        </div>
      </div>

      <UnlockSheet
        open={sheetOpen}
        episode={sheetEp}
        onClose={() => setSheetOpen(false)}
        onConfirmed={onConfirmed}
        buyoutCredits={
          data?.dramaUnlocked
            ? null
            : data?.buyoutCredits
              ? Number(data.buyoutCredits)
              : null
        }
        onBuyDrama={onBuyDrama}
        vipActive={!!data?.vipActive || !!user?.isVip}
      />
    </div>
  );
}

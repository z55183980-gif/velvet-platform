"use client";

import { useEffect, useRef, useState } from "react";
import { Star, Play, ChevronLeft, ListVideo } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { useAuth } from "@/components/auth-context";
import { EpisodeList } from "@/components/episode-list";
import { UnlockSheet } from "@/components/unlock-sheet";
import { VideoPlayer } from "@/components/video-player";
import { VerticalPlayer } from "@/components/mobile/vertical-player";
import { EpisodeDrawer } from "@/components/mobile/episode-drawer";
import { useIsMobile } from "@/hooks/use-is-mobile";
import {
  loadDramaDetail,
  loadHome,
  getPlayUrl,
  addFavorite,
  removeFavorite,
  getFavorites,
  getWatchHistory,
  unlockDrama,
} from "@/lib/api";
import { categoryName, type Drama, type Episode } from "@/lib/mock-data";
import { pickContentText } from "@/lib/languages";
import { formatCredits, mediaUrl, cn } from "@/lib/utils";
import { DramaCard } from "@/components/drama-card";

function isUrl(s: string) {
  return /^https?:\/\//.test(s) || s.startsWith("/");
}

function isHls(url: string) {
  return /\.m3u8(\?|$)/i.test(url);
}

export function DramaDetail({ id }: { id: string }) {
  const { locale, t } = useLocale();
  const { user, unlock, openLogin, ready: authReady } = useAuth();
  const { mobile: isMobile, ready: mobileReady } = useIsMobile();
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
  const [watching, setWatching] = useState(false);
  const [related, setRelated] = useState<Drama[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerSectionRef = useRef<HTMLDivElement>(null);
  const resumeApplied = useRef(false);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setWatching(false);
    setRelated([]);
    setNotFound(false);
    loadDramaDetail(id, { signal: ac.signal })
      .then((d) => {
        if (ac.signal.aborted) return;
        if (d) {
          setData(d);
          const nos = new Set(d.episodes.filter((e) => e.isFree || e.unlocked).map((e) => e.no));
          setUnlockedNos(nos);
          setSelected(null);
        } else setNotFound(true);
      })
      .catch(() => {
        if (!ac.signal.aborted) setNotFound(true);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
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
    if (!authReady || !user) {
      setPlayUrl(null);
      setPlayErr(null);
      return;
    }
    const ac = new AbortController();
    setPlayUrl(null);
    setPlayErr(null);
    getPlayUrl(String(selected.id), { signal: ac.signal })
      .then((r) => {
        if (ac.signal.aborted) return;
        setPlayUrl(r.playUrl);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        if (e?.status === 401) setPlayErr(t("errors.loginRequired"));
        else setPlayErr(e?.message || t("player.error"));
      });
    return () => ac.abort();
  }, [playerReady, selected?.id, user, authReady, t]);

  useEffect(() => {
    if (!data?.drama.categorySlug) return;
    const ac = new AbortController();
    loadHome(1, 12, { category: data.drama.categorySlug, sort: "hot", signal: ac.signal })
      .then((r) => {
        if (ac.signal.aborted) return;
        setRelated((r.rows || []).filter((d) => d.id !== data.drama.id).slice(0, 8));
      })
      .catch(() => {
        if (!ac.signal.aborted) setRelated([]);
      });
    return () => ac.abort();
  }, [data?.drama.categorySlug, data?.drama.id]);

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

  if (loading || !mobileReady) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-6 md:py-10">
        <div className="flex flex-col gap-6 md:flex-row md:gap-10">
          <div className="aspect-[2/3] w-full max-w-[280px] animate-pulse rounded-lg bg-surface-2" />
          <div className="flex-1 space-y-4">
            <div className="h-8 w-2/3 animate-pulse rounded bg-surface-2" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-surface-2" />
            <div className="h-24 w-full animate-pulse rounded bg-surface-2" />
            <div className="h-10 w-40 animate-pulse rounded-full bg-surface-2" />
          </div>
        </div>
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
      if (isMobile) setWatching(true);
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
    if (isMobile) {
      setWatching(true);
      return;
    }
    requestAnimationFrame(() => {
      playerSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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
        if (isMobile) setWatching(true);
      }
    } else openUnlock(ep);
  };

  const tags = [
    cat,
    drama.isVip ? t("card.vip") : null,
    drama.freeCount > 0 ? t("card.free") : null,
    `${drama.episodesCount} ${t("card.episodes")}`,
  ].filter(Boolean) as string[];

  if (isMobile) {
    if (watching) {
      return (
        <div className="fixed inset-0 z-[70] bg-black">
          <div className="absolute left-0 right-0 top-0 z-30 flex items-center justify-between px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
            <button
              type="button"
              onClick={() => setWatching(false)}
              className="grid h-10 w-10 place-items-center rounded-full bg-black/40 text-white backdrop-blur"
              aria-label="back"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
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
      <div className="relative pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
        <div className="px-4 pt-4">
          <div className="flex gap-4">
            <div className="relative h-[138px] w-[98px] shrink-0 overflow-hidden rounded-xl bg-surface-2">
              {coverIsImg ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={drama.cover[0]} alt="" className="h-full w-full object-cover" />
              ) : (
                <div
                  className="h-full w-full"
                  style={{
                    background: `linear-gradient(150deg, ${drama.cover[0]}, ${drama.cover[1]})`,
                  }}
                />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <h1 className="text-[20px] font-medium leading-7 text-white">{title}</h1>
              <div className="mt-3 flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex max-w-[6.5rem] items-center truncate rounded bg-white/[0.06] px-2 py-1.5 text-[12px] leading-none text-white/70"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              {resumeHint && resumeHint.progressSec > 5 && (
                <p className="mt-2 text-caption text-white/40">
                  {t("detail.resumeHint", {
                    n: resumeHint.epNo,
                    time: `${Math.floor(resumeHint.progressSec / 60)}:${String(resumeHint.progressSec % 60).padStart(2, "0")}`,
                  })}
                </p>
              )}
            </div>
          </div>

          <section className="mt-6">
            <h2 className="text-[16px] font-medium text-white">{t("detail.basicInfo")}</h2>
            {desc ? (
              <p className="mt-3 text-[14px] leading-6 text-white/40 line-clamp-4">{desc}</p>
            ) : null}

            {drama.creator?.displayName && (
              <div className="mt-4 flex gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <div className="flex min-w-[72px] flex-col items-center">
                  <div className="grid h-14 w-14 place-items-center overflow-hidden rounded-full bg-white/10 text-body-sm font-medium text-white/80">
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
                  <p className="mt-2 max-w-[72px] truncate text-center text-[14px] text-white/90">
                    {drama.creator.displayName}
                  </p>
                </div>
              </div>
            )}
          </section>

          <div className="mt-8">
            <EpisodeList
              episodes={data.episodes}
              episodesCount={drama.episodesCount}
              selectedNo={selected?.no}
              layout="grid"
              isUnlocked={isUnlocked}
              onUnlock={openUnlock}
              onSelect={selectEpisode}
            />
          </div>

          {related.length > 0 && (
            <section className="mt-10">
              <h2 className="mb-4 text-[16px] font-medium text-white">{t("detail.related")}</h2>
              <div
                className={cn(
                  "flex gap-3 overflow-x-auto pb-2",
                  "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                )}
              >
                {related.map((d) => (
                  <div key={d.id} className="w-[108px] shrink-0">
                    <DramaCard drama={d} compact variant="grid" />
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/5 bg-[#1a1a1a]/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl">
          <button
            type="button"
            onClick={onWatchFree}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full text-[16px] font-medium text-white"
            style={{
              background: "linear-gradient(92.27deg, #c81038 0.32%, #e83a58)",
            }}
          >
            <Play className="h-5 w-5 fill-white" />
            {t("detail.playPrimary")}
          </button>
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

  return (
    <div className="relative overflow-hidden pb-16 md:pb-24">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[min(920px,100%)] overflow-hidden">
        {coverIsImg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={drama.cover[0]}
            alt=""
            className="absolute left-1/2 top-0 h-full w-[1920px] max-w-none -translate-x-1/2 object-cover opacity-40 blur-2xl scale-110"
          />
        ) : (
          <div
            className="absolute inset-0 opacity-50"
            style={{
              background: `linear-gradient(150deg, ${drama.cover[0]}, ${drama.cover[1]})`,
            }}
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 80% 64% at 51% -3%, rgba(200,16,56,0.12) 0%, transparent 100%), linear-gradient(180deg, rgba(11,13,18,0.55) 0%, var(--color-base) 78%)",
          }}
        />
      </div>

      <div className="relative z-10 mx-auto max-w-[1280px] px-6 pt-8 md:px-10 md:pt-10">
        <div className="flex w-full flex-col gap-8 sm:flex-row sm:items-stretch">
          <div className="relative h-[238px] w-[168px] shrink-0 overflow-hidden rounded-2xl bg-surface-2 shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
            {coverIsImg ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={drama.cover[0]} alt="" className="h-full w-full object-cover" />
            ) : (
              <div
                className="h-full w-full"
                style={{
                  background: `linear-gradient(150deg, ${drama.cover[0]}, ${drama.cover[1]})`,
                }}
              />
            )}
          </div>

          <div className="flex min-h-[238px] min-w-0 max-w-[800px] flex-1 flex-col">
            <h1 className="mb-4 text-[28px] font-medium leading-[44px] text-white/95">
              {title}
            </h1>

            <div className="flex flex-wrap gap-x-3 gap-y-3 overflow-hidden">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex h-8 max-w-[150px] items-center truncate rounded-md bg-white/[0.08] px-2.5 text-[16px] leading-none text-white/80"
                >
                  {tag}
                </span>
              ))}
            </div>

            {resumeHint && resumeHint.progressSec > 5 && (
              <p className="mt-3 text-caption text-white/45">
                {t("detail.resumeHint", {
                  n: resumeHint.epNo,
                  time: `${Math.floor(resumeHint.progressSec / 60)}:${String(resumeHint.progressSec % 60).padStart(2, "0")}`,
                })}
              </p>
            )}

            <div className="mt-auto flex flex-wrap items-center gap-3 pt-6">
              <button
                type="button"
                onClick={onWatchFree}
                className="group relative z-0 inline-flex h-[45px] w-[162px] items-center justify-center rounded-xl text-white/95 transition-opacity duration-150 hover:opacity-95"
                style={{
                  background: "linear-gradient(92.27deg, #c81038 0.32%, #e83a58)",
                }}
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-xl opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                  style={{
                    background: "linear-gradient(92.27deg, #9a0c2a 0.32%, #c01838)",
                  }}
                />
                <Play className="relative z-[1] h-[18px] w-[18px] fill-white" />
                <span className="relative z-[1] ml-2 text-[18px] font-medium leading-none">
                  {t("detail.playPrimary")}
                </span>
              </button>

              <button
                type="button"
                onClick={toggleFavorite}
                disabled={favBusy}
                className={cn(
                  "inline-flex h-[45px] items-center gap-2 rounded-xl px-4 text-[15px] font-medium transition-colors",
                  favorited
                    ? "bg-gold/15 text-gold"
                    : "bg-white/[0.08] text-white/80 hover:bg-white/[0.14] hover:text-white",
                )}
              >
                <Star className={`h-4 w-4 ${favorited ? "fill-gold text-gold" : ""}`} />
                {favorited ? t("detail.favorited") : t("detail.favorite")}
              </button>
            </div>
          </div>
        </div>

        <div ref={playerSectionRef} className="mt-10 scroll-mt-20 overflow-hidden rounded-xl bg-black">
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

        <section className="mt-[72px]">
          <h2 className="text-[20px] font-medium text-white/90">{t("detail.basicInfo")}</h2>
          {desc ? (
            <p className="mt-4 max-w-[1080px] text-[16px] leading-8 text-white/40">{desc}</p>
          ) : null}

          {drama.creator?.displayName && (
            <div className="mt-7 flex flex-wrap gap-x-7 gap-y-5">
              <div className="flex min-w-[72px] flex-col items-center">
                <div className="grid h-14 w-14 place-items-center overflow-hidden rounded-full bg-white/10 text-body-sm font-medium text-white/80">
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
                <p className="mt-2 max-w-[98px] truncate text-center text-[14px] font-medium leading-5 text-white/95">
                  {drama.creator.displayName}
                </p>
              </div>
            </div>
          )}
        </section>

        <div className="mt-[60px]">
          <EpisodeList
            episodes={data.episodes}
            episodesCount={drama.episodesCount}
            selectedNo={selected?.no}
            layout="grid"
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

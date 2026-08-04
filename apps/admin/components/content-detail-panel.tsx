"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminApproveDrama,
  adminBatchEpisodes,
  adminCreateEpisode,
  adminDeleteDrama,
  adminDeleteEpisode,
  adminGetDrama,
  adminListSettings,
  adminOfflineDrama,
  adminOnlineDrama,
  adminRejectDrama,
  adminReorderEpisodes,
  adminRetryTranscode,
  adminSetFeatured,
  adminSetOfficial,
  adminSetSortWeight,
  adminUpdateDrama,
  adminUpdateEpisode,
} from "@velvet/api-client";
import { Button, DataTable, Input, Select, StatCard, fmtNum, type Column } from "@velvet/ui";
import { ConfirmModal } from "@/components/glass-modal";
import { useI18n, statusLabel } from "@/lib/i18n";

type Episode = {
  id: string | number;
  episodeNumber?: number;
  title?: string;
  isFree?: boolean;
  priceCredits?: number | string;
  transcodeStatus?: string;
  thumbnailUrl?: string;
  hlsUrl?: string;
  originalUrl?: string;
  durationSec?: number;
};

type Drama = {
  id: string | number;
  titleZh?: string;
  titleEn?: string;
  slug?: string;
  status?: string;
  coverUrl?: string;
  descriptionZh?: string;
  descriptionEn?: string;
  isFeatured?: boolean;
  isOfficial?: boolean;
  sortWeight?: number;
  freeEpisodeCount?: number;
  lockMode?: "FREE_FIRST_N" | "VIP_ALL" | "ALL_FREE" | null;
  buyoutCredits?: number | string | null;
  viewCount?: number;
  unlockCount?: number;
  favoriteCount?: number;
  publishedAt?: string | null;
  sourceType?: string;
  creator?: { displayName?: string };
  category?: { nameZh?: string; nameEn?: string };
  episodes?: Episode[];
};

type DetailTab = "info" | "episodes" | "policy";

type LockMode = "FREE_FIRST_N" | "VIP_ALL" | "ALL_FREE";

function isEpisodeFreeByPolicy(opts: {
  episodeIsFree: boolean;
  episodeNumber: number;
  mode: LockMode;
  freeEpisodeCount: number;
}) {
  if (opts.episodeIsFree) return true;
  if (opts.mode === "ALL_FREE") return true;
  if (opts.mode === "VIP_ALL") return false;
  return opts.episodeNumber <= Math.max(0, Math.floor(opts.freeEpisodeCount || 0));
}

export function ContentDetailPanel({
  id,
  onDeleted,
}: {
  id: string;
  onDeleted?: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [tab, setTab] = useState<DetailTab>("info");
  const [reason, setReason] = useState("");
  const [weight, setWeight] = useState(0);
  const [freeEpisodes, setFreeEpisodes] = useState(3);
  const [lockMode, setLockMode] = useState<string>("INHERIT");
  const [buyoutCredits, setBuyoutCredits] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteEpisodeId, setDeleteEpisodeId] = useState<string | null>(null);
  const [selectedEps, setSelectedEps] = useState<Set<string>>(new Set());
  const [batchFree, setBatchFree] = useState<"keep" | "1" | "0">("keep");
  const [batchPrice, setBatchPrice] = useState("");
  const [newEp, setNewEp] = useState({
    title: "",
    sourceUrl: "",
    isFree: false,
    priceCredits: 10,
  });
  const [previewEp, setPreviewEp] = useState(1);
  const [previewVip, setPreviewVip] = useState(false);

  const detailQ = useQuery({
    queryKey: ["admin", "drama", id],
    queryFn: () => adminGetDrama(id) as Promise<Drama>,
  });

  const settingsQ = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: async () => {
      const result = (await adminListSettings()) as {
        items?: { key: string; value: unknown }[];
      };
      return result.items ?? [];
    },
  });

  useEffect(() => {
    if (!detailQ.data) return;
    setWeight(detailQ.data.sortWeight ?? 0);
    setFreeEpisodes(detailQ.data.freeEpisodeCount ?? 3);
    setLockMode(detailQ.data.lockMode || "INHERIT");
    setBuyoutCredits(Number(detailQ.data.buyoutCredits || 0));
  }, [detailQ.data]);

  const actionMut = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: async () => {
      setError(null);
      setSelectedEps(new Set());
      await qc.invalidateQueries({ queryKey: ["admin", "drama", id] });
      await qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const act = (action: () => Promise<unknown>) => actionMut.mutate(action);
  const drama = detailQ.data;
  const episodes = drama?.episodes ?? [];

  const moveEpisode = (episodeId: string, dir: -1 | 1) => {
    const list = [...episodes];
    const idx = list.findIndex((e) => String(e.id) === episodeId);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= list.length) return;
    const swapped = [...list];
    [swapped[idx], swapped[next]] = [swapped[next], swapped[idx]];
    act(() => adminReorderEpisodes(id, swapped.map((e) => String(e.id))));
  };

  const globalMode = useMemo(() => {
    const raw = settingsQ.data?.find((s) => s.key === "episodeLockMode")?.value;
    return raw === "VIP_ALL" || raw === "ALL_FREE" || raw === "FREE_FIRST_N"
      ? (raw as LockMode)
      : ("FREE_FIRST_N" as LockMode);
  }, [settingsQ.data]);

  const globalFreeCount = useMemo(() => {
    const raw = settingsQ.data?.find((s) => s.key === "defaultFreeEpisodes")?.value;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 3;
  }, [settingsQ.data]);

  const effectiveMode: LockMode =
    lockMode === "INHERIT" ? globalMode : (lockMode as LockMode);
  const effectiveFree = freeEpisodes;

  const previewResult = useMemo(() => {
    const ep = episodes.find((e) => e.episodeNumber === previewEp);
    const free = isEpisodeFreeByPolicy({
      episodeIsFree: !!ep?.isFree,
      episodeNumber: previewEp,
      mode: effectiveMode,
      freeEpisodeCount: effectiveFree,
    });
    if (free) return "free" as const;
    if (previewVip) return "vip" as const;
    return "locked" as const;
  }, [episodes, previewEp, previewVip, effectiveMode, effectiveFree]);

  const episodeColumns: Column<Episode>[] = useMemo(
    () => [
      {
        key: "select",
        header: "",
        cell: (episode) => (
          <input
            type="checkbox"
            checked={selectedEps.has(String(episode.id))}
            onChange={(e) =>
              setSelectedEps((prev) => {
                const next = new Set(prev);
                e.target.checked
                  ? next.add(String(episode.id))
                  : next.delete(String(episode.id));
                return next;
              })
            }
          />
        ),
      },
      {
        key: "number",
        header: t("episodeNumber"),
        cell: (episode) => String(episode.episodeNumber ?? "—"),
        className: "tabular-nums",
      },
      {
        key: "title",
        header: t("colTitle"),
        cell: (episode) => (
          <Input
            defaultValue={episode.title || ""}
            onBlur={(e) =>
              e.target.value !== (episode.title || "") &&
              act(() => adminUpdateEpisode(String(episode.id), { title: e.target.value }))
            }
          />
        ),
      },
      {
        key: "media",
        header: t("playUrl"),
        cell: (episode) => (
          <Input
            className="min-w-[12rem]"
            defaultValue={episode.hlsUrl || episode.originalUrl || ""}
            placeholder="m3u8 / mp4"
            onBlur={(e) => {
              const next = e.target.value.trim();
              const prev = episode.hlsUrl || episode.originalUrl || "";
              if (next !== prev) {
                act(() =>
                  adminUpdateEpisode(String(episode.id), {
                    sourceUrl: next || undefined,
                    hlsUrl: next || "",
                    originalUrl: next || "",
                  }),
                );
              }
            }}
          />
        ),
      },
      {
        key: "free",
        header: t("free"),
        cell: (episode) => (
          <input
            type="checkbox"
            defaultChecked={!!episode.isFree}
            onChange={(e) =>
              act(() =>
                adminUpdateEpisode(String(episode.id), { isFree: e.target.checked }),
              )
            }
          />
        ),
      },
      {
        key: "credits",
        header: t("colCredits"),
        cell: (episode) => (
          <Input
            type="number"
            className="w-24"
            defaultValue={Number(episode.priceCredits || 0)}
            onBlur={(e) =>
              Number(e.target.value) !== Number(episode.priceCredits || 0) &&
              act(() =>
                adminUpdateEpisode(String(episode.id), {
                  priceCredits: Number(e.target.value),
                }),
              )
            }
          />
        ),
      },
      {
        key: "transcode",
        header: t("transcodeStatus"),
        cell: (episode) => (
          <span className={episode.transcodeStatus === "FAILED" ? "text-danger" : ""}>
            {episode.transcodeStatus || "—"}
          </span>
        ),
      },
      {
        key: "actions",
        header: "",
        cell: (episode) => (
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={actionMut.isPending}
              onClick={() => moveEpisode(String(episode.id), -1)}
            >
              {t("moveUp")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={actionMut.isPending}
              onClick={() => moveEpisode(String(episode.id), 1)}
            >
              {t("moveDown")}
            </Button>
            {["FAILED", "PENDING"].includes(episode.transcodeStatus || "") ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={actionMut.isPending}
                onClick={() => act(() => adminRetryTranscode(String(episode.id)))}
              >
                {t("retryTranscode")}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="danger"
              disabled={actionMut.isPending}
              onClick={() => setDeleteEpisodeId(String(episode.id))}
            >
              {t("delete")}
            </Button>
          </div>
        ),
      },
    ],
    [t, actionMut.isPending, selectedEps, episodes],
  );

  const handleDeleteDrama = () => {
    actionMut.mutate(() => adminDeleteDrama(id, reason || "admin delete"), {
      onSuccess: async () => {
        setDeleteOpen(false);
        setError(null);
        await qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
        if (onDeleted) onDeleted();
        else router.replace("/content");
      },
    });
  };

  if (detailQ.isLoading) {
    return <p className="text-ink-muted">{t("loading")}</p>;
  }

  if (!drama) {
    return <p className="text-ink-muted">{t("empty")}</p>;
  }

  return (
    <>
      {error || detailQ.error ? (
        <p className="mb-3 text-body-sm text-danger">
          {error || (detailQ.error as Error).message}
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-start gap-4">
        {drama.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={drama.coverUrl}
            alt=""
            className="h-28 w-20 rounded-lg bg-surface-2 object-cover"
          />
        ) : (
          <div className="h-28 w-20 rounded-lg bg-surface-2" />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-h3 font-semibold">
            {drama.titleZh || drama.titleEn || "—"}
          </h1>
          <p className="mt-1 text-body-sm text-ink-muted">
            slug {drama.slug} · {t("status")}{" "}
            <strong>{statusLabel(t, drama.status)}</strong>
            {drama.sourceType ? ` · ${drama.sourceType}` : ""}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            <StatCard label={t("views")} value={fmtNum(drama.viewCount)} />
            <StatCard label={t("unlocks")} value={fmtNum(drama.unlockCount)} />
            <StatCard label={t("favorites")} value={fmtNum(drama.favoriteCount)} />
            <StatCard label={t("episodeCount")} value={episodes.length} />
          </div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ["info", t("tabDramaInfo")],
            ["episodes", t("tabEpisodes")],
            ["policy", t("tabPlayPolicy")],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={tab === key ? "primary" : "secondary"}
            onClick={() => setTab(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {tab === "info" ? (
        <div className="space-y-4">
          <div className="space-y-2 text-body-sm">
            <p>
              {t("colCreator")} {drama.creator?.displayName || "—"} · {t("category")}{" "}
              {drama.category?.nameZh || drama.category?.nameEn || "—"}
            </p>
            <p className="whitespace-pre-wrap text-ink-muted">
              {drama.descriptionZh || drama.descriptionEn || ""}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-64"
              placeholder={t("actionReasonPlaceholder")}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            {drama.status === "PENDING_REVIEW" ? (
              <>
                <Button
                  size="sm"
                  disabled={actionMut.isPending}
                  onClick={() => act(() => adminApproveDrama(id))}
                >
                  {t("approveReview")}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={actionMut.isPending}
                  onClick={() => act(() => adminRejectDrama(id, reason || "rejected"))}
                >
                  {t("reject")}
                </Button>
              </>
            ) : null}
            {drama.status === "LIVE" ? (
              <Button
                size="sm"
                variant="danger"
                disabled={actionMut.isPending}
                onClick={() => act(() => adminOfflineDrama(id, reason))}
              >
                {t("forceOffline")}
              </Button>
            ) : null}
            {["OFFLINE", "REJECTED"].includes(drama.status || "") ? (
              <Button
                size="sm"
                disabled={actionMut.isPending}
                onClick={() => act(() => adminOnlineDrama(id, reason))}
              >
                {t("restoreOnline")}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="danger"
              disabled={actionMut.isPending}
              onClick={() => setDeleteOpen(true)}
            >
              {t("delete")}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <p className="w-full text-caption text-ink-subtle">{t("heroHintContent")}</p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => act(() => adminSetFeatured(id, !drama.isFeatured))}
            >
              {t("featuredFlag")}：{drama.isFeatured ? t("on") : t("off")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => act(() => adminSetOfficial(id, !drama.isOfficial))}
            >
              {t("official")}：{drama.isOfficial ? t("on") : t("off")}
            </Button>
            <Input
              type="number"
              className="w-24"
              value={weight}
              onChange={(e) => setWeight(Number(e.target.value))}
              title={t("sortWeightTitle")}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => act(() => adminSetSortWeight(id, weight))}
            >
              {t("saveSortWeight")}
            </Button>
          </div>
        </div>
      ) : null}

      {tab === "episodes" ? (
        <div className="space-y-4">
          <div className="card glass-card space-y-3 p-3">
            <p className="text-caption font-medium text-ink-muted">{t("addEpisode")}</p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-caption text-ink-muted">
                {t("colTitle")}
                <Input
                  className="mt-1 w-40"
                  value={newEp.title}
                  onChange={(e) => setNewEp((v) => ({ ...v, title: e.target.value }))}
                />
              </label>
              <label className="text-caption text-ink-muted">
                {t("playUrl")}
                <Input
                  className="mt-1 w-72"
                  placeholder="https://...m3u8"
                  value={newEp.sourceUrl}
                  onChange={(e) => setNewEp((v) => ({ ...v, sourceUrl: e.target.value }))}
                />
              </label>
              <label className="flex items-center gap-2 text-caption text-ink-muted">
                <input
                  type="checkbox"
                  checked={newEp.isFree}
                  onChange={(e) => setNewEp((v) => ({ ...v, isFree: e.target.checked }))}
                />
                {t("free")}
              </label>
              {!newEp.isFree ? (
                <label className="text-caption text-ink-muted">
                  {t("colCredits")}
                  <Input
                    type="number"
                    className="mt-1 w-24"
                    value={newEp.priceCredits}
                    onChange={(e) =>
                      setNewEp((v) => ({ ...v, priceCredits: Number(e.target.value) }))
                    }
                  />
                </label>
              ) : null}
              <Button
                size="sm"
                disabled={actionMut.isPending || !newEp.sourceUrl.trim()}
                onClick={() =>
                  act(async () => {
                    await adminCreateEpisode(id, {
                      title: newEp.title || undefined,
                      sourceUrl: newEp.sourceUrl.trim(),
                      isFree: newEp.isFree,
                      priceCredits: newEp.isFree ? 0 : newEp.priceCredits,
                    });
                    setNewEp({ title: "", sourceUrl: "", isFree: false, priceCredits: 10 });
                  })
                }
              >
                {t("addEpisode")}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2 card glass-card p-3">
            <span className="text-caption text-ink-muted">
              {t("selectedCount", { n: selectedEps.size })}
            </span>
            <Select
              className="w-36"
              value={batchFree}
              onChange={(e) => setBatchFree(e.target.value as typeof batchFree)}
            >
              <option value="keep">{t("batchKeepFree")}</option>
              <option value="1">{t("batchSetFree")}</option>
              <option value="0">{t("batchSetPaid")}</option>
            </Select>
            <Input
              className="w-28"
              type="number"
              placeholder={t("priceCreditsPerEpisode")}
              value={batchPrice}
              onChange={(e) => setBatchPrice(e.target.value)}
            />
            <Button
              size="sm"
              disabled={
                !selectedEps.size ||
                actionMut.isPending ||
                (batchFree === "keep" && batchPrice === "")
              }
              onClick={() =>
                act(() =>
                  adminBatchEpisodes(id, {
                    ids: [...selectedEps],
                    ...(batchFree !== "keep" ? { isFree: batchFree === "1" } : {}),
                    ...(batchPrice !== "" ? { priceCredits: Number(batchPrice) } : {}),
                  }),
                )
              }
            >
              {t("batchApply")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setSelectedEps(
                  episodes.length > 0 &&
                    episodes.every((ep) => selectedEps.has(String(ep.id)))
                    ? new Set()
                    : new Set(episodes.map((ep) => String(ep.id))),
                )
              }
            >
              {t("selectAllPage")}
            </Button>
          </div>

          <DataTable
            columns={episodeColumns}
            rows={episodes}
            emptyTitle={t("emptyEpisodes")}
          />
        </div>
      ) : null}

      {tab === "policy" ? (
        <div className="space-y-4">
          <p className="text-body-sm text-ink-muted">
            {t("policyGlobalHint", {
              mode:
                globalMode === "VIP_ALL"
                  ? t("lockModeVipAll")
                  : globalMode === "ALL_FREE"
                    ? t("lockModeAllFree")
                    : t("lockModeFreeFirstN"),
              n: globalFreeCount,
            })}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-caption text-ink-muted">
              {t("lockMode")}
              <Select
                className="mt-1 w-44"
                value={lockMode}
                onChange={(e) => setLockMode(e.target.value)}
              >
                <option value="INHERIT">{t("lockModeInherit")}</option>
                <option value="FREE_FIRST_N">{t("lockModeFreeFirstN")}</option>
                <option value="VIP_ALL">{t("lockModeVipAll")}</option>
                <option value="ALL_FREE">{t("lockModeAllFree")}</option>
              </Select>
            </label>
            <label className="text-caption text-ink-muted">
              {t("freeEpisodes")}
              <Input
                type="number"
                className="mt-1 w-28"
                value={freeEpisodes}
                disabled={effectiveMode === "VIP_ALL" || effectiveMode === "ALL_FREE"}
                onChange={(e) => setFreeEpisodes(Number(e.target.value))}
              />
            </label>
            <label className="text-caption text-ink-muted">
              {t("buyoutCreditsLabel")}
              <Input
                type="number"
                className="mt-1 w-28"
                value={buyoutCredits}
                onChange={(e) => setBuyoutCredits(Number(e.target.value))}
              />
            </label>
            <Button
              size="sm"
              disabled={actionMut.isPending}
              onClick={() =>
                act(() =>
                  adminUpdateDrama(id, {
                    lockMode: lockMode === "INHERIT" ? null : lockMode,
                    freeEpisodeCount: freeEpisodes,
                    buyoutCredits: buyoutCredits > 0 ? buyoutCredits : null,
                  }),
                )
              }
            >
              {t("saveLockPolicy")}
            </Button>
          </div>

          <div className="card glass-card space-y-3 p-4">
            <p className="text-caption font-medium text-ink-muted">{t("policyPreview")}</p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-caption text-ink-muted">
                {t("episodeNumber")}
                <Input
                  type="number"
                  className="mt-1 w-24"
                  min={1}
                  value={previewEp}
                  onChange={(e) => setPreviewEp(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
              <label className="flex items-center gap-2 text-caption text-ink-muted">
                <input
                  type="checkbox"
                  checked={previewVip}
                  onChange={(e) => setPreviewVip(e.target.checked)}
                />
                {t("previewAsVip")}
              </label>
            </div>
            <p className="text-body-sm">
              {previewResult === "free"
                ? t("previewResultFree")
                : previewResult === "vip"
                  ? t("previewResultVip")
                  : t("previewResultLocked")}
            </p>
          </div>
        </div>
      ) : null}

      <ConfirmModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDeleteDrama}
        message={t("confirmDeleteDrama")}
        busy={actionMut.isPending}
      />
      <ConfirmModal
        open={!!deleteEpisodeId}
        onClose={() => setDeleteEpisodeId(null)}
        onConfirm={() => {
          if (!deleteEpisodeId) return;
          actionMut.mutate(() => adminDeleteEpisode(deleteEpisodeId), {
            onSuccess: async () => {
              setDeleteEpisodeId(null);
              await qc.invalidateQueries({ queryKey: ["admin", "drama", id] });
            },
          });
        }}
        message={t("confirmDeleteEpisode")}
        busy={actionMut.isPending}
      />
    </>
  );
}

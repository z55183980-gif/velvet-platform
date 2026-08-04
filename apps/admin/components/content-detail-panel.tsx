"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminApproveDrama,
  adminDeleteDrama,
  adminGetDrama,
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
  priceCredits?: number;
  transcodeStatus?: string;
  thumbnailUrl?: string;
};
type Drama = {
  id: string | number;
  titleZh?: string;
  titleVi?: string;
  slug?: string;
  status?: string;
  coverUrl?: string;
  descriptionZh?: string;
  descriptionVi?: string;
  isFeatured?: boolean;
  isOfficial?: boolean;
  sortWeight?: number;
  freeEpisodeCount?: number;
  lockMode?: "FREE_FIRST_N" | "VIP_ALL" | "ALL_FREE" | null;
  viewCount?: number;
  unlockCount?: number;
  favoriteCount?: number;
  creator?: { displayName?: string };
  category?: { nameZh?: string; nameVi?: string };
  episodes?: Episode[];
};

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
  const [reason, setReason] = useState("");
  const [weight, setWeight] = useState(0);
  const [freeEpisodes, setFreeEpisodes] = useState(3);
  const [lockMode, setLockMode] = useState<string>("INHERIT");
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const detailQ = useQuery({
    queryKey: ["admin", "drama", id],
    queryFn: () => adminGetDrama(id) as Promise<Drama>,
  });

  useEffect(() => {
    if (!detailQ.data) return;
    setWeight(detailQ.data.sortWeight ?? 0);
    setFreeEpisodes(detailQ.data.freeEpisodeCount ?? 3);
    setLockMode(detailQ.data.lockMode || "INHERIT");
  }, [detailQ.data]);

  const actionMut = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "drama", id] });
      await qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const act = (action: () => Promise<unknown>) => actionMut.mutate(action);
  const drama = detailQ.data;
  const episodes = drama?.episodes ?? [];

  const episodeColumns: Column<Episode>[] = useMemo(
    () => [
      { key: "number", header: t("episodeNumber"), cell: (episode) => String(episode.episodeNumber ?? "—") },
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
        key: "free",
        header: t("free"),
        cell: (episode) => (
          <input
            type="checkbox"
            defaultChecked={!!episode.isFree}
            onChange={(e) => act(() => adminUpdateEpisode(String(episode.id), { isFree: e.target.checked }))}
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
              act(() => adminUpdateEpisode(String(episode.id), { priceCredits: Number(e.target.value) }))
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
        key: "thumbnail",
        header: t("thumbnailUrl"),
        cell: (episode) => (
          <Input
            className="w-48"
            defaultValue={episode.thumbnailUrl || ""}
            onBlur={(e) =>
              e.target.value !== (episode.thumbnailUrl || "") &&
              act(() => adminUpdateEpisode(String(episode.id), { thumbnailUrl: e.target.value }))
            }
          />
        ),
      },
      {
        key: "actions",
        header: "",
        cell: (episode) =>
          ["FAILED", "PENDING"].includes(episode.transcodeStatus || "") ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={actionMut.isPending}
              onClick={() => act(() => adminRetryTranscode(String(episode.id)))}
            >
              {t("retryTranscode")}
            </Button>
          ) : null,
      },
    ],
    [t, actionMut.isPending],
  );

  const handleDelete = () => {
    actionMut.mutate(() => adminDeleteDrama(id, reason || "admin delete"), {
      onSuccess: async () => {
        setDeleteOpen(false);
        setError(null);
        await qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
        if (onDeleted) {
          onDeleted();
        } else {
          router.replace("/content");
        }
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
        <p className="mb-3 text-body-sm text-danger">{error || (detailQ.error as Error).message}</p>
      ) : null}
      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <StatCard label={t("views")} value={fmtNum(drama.viewCount)} />
        <StatCard label={t("unlocks")} value={fmtNum(drama.unlockCount)} />
        <StatCard label={t("favorites")} value={fmtNum(drama.favoriteCount)} />
        <StatCard label={t("episodeCount")} value={episodes.length} />
      </div>
      <div className="mb-8 grid gap-6 lg:grid-cols-[200px_1fr]">
        {drama.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={drama.coverUrl} alt="" className="aspect-[3/4] w-full rounded-lg bg-surface-2 object-cover" />
        ) : (
          <div className="aspect-[3/4] rounded-lg bg-surface-2" />
        )}
        <div className="space-y-3 text-body-sm">
          <p>
            slug {drama.slug} · {t("status")} <strong>{statusLabel(t, drama.status)}</strong>
          </p>
          <p>
            {t("colCreator")} {drama.creator?.displayName || "—"} · {t("category")}{" "}
            {drama.category?.nameZh || drama.category?.nameVi || "—"}
          </p>
          <p className="whitespace-pre-wrap text-ink-muted">{drama.descriptionZh || drama.descriptionVi}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-64"
              placeholder={t("actionReasonPlaceholder")}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            {drama.status === "PENDING_REVIEW" ? (
              <>
                <Button size="sm" disabled={actionMut.isPending} onClick={() => act(() => adminApproveDrama(id))}>
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
              <Button size="sm" disabled={actionMut.isPending} onClick={() => act(() => adminOnlineDrama(id, reason))}>
                {t("restoreOnline")}
              </Button>
            ) : null}
            <Button size="sm" variant="danger" disabled={actionMut.isPending} onClick={() => setDeleteOpen(true)}>
              {t("delete")}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <p className="w-full text-caption text-ink-subtle">{t("heroHintContent")}</p>
            <Button size="sm" variant="secondary" onClick={() => act(() => adminSetFeatured(id, !drama.isFeatured))}>
              {t("featuredFlag")}：{drama.isFeatured ? t("on") : t("off")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => act(() => adminSetOfficial(id, !drama.isOfficial))}>
              {t("official")}：{drama.isOfficial ? t("on") : t("off")}
            </Button>
            <Input
              type="number"
              className="w-24"
              value={weight}
              onChange={(e) => setWeight(Number(e.target.value))}
              title={t("sortWeightTitle")}
            />
            <Button size="sm" variant="secondary" onClick={() => act(() => adminSetSortWeight(id, weight))}>
              {t("saveSortWeight")}
            </Button>
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
            <Input
              type="number"
              className="w-24"
              value={freeEpisodes}
              disabled={lockMode === "VIP_ALL" || lockMode === "ALL_FREE"}
              onChange={(e) => setFreeEpisodes(Number(e.target.value))}
              title={t("freeEpisodes")}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                act(() =>
                  adminUpdateDrama(id, {
                    lockMode: lockMode === "INHERIT" ? null : lockMode,
                    freeEpisodeCount: freeEpisodes,
                  }),
                )
              }
            >
              {t("saveLockPolicy")}
            </Button>
          </div>
        </div>
      </div>
      <h2 className="mb-3 text-h4">{t("episodeManagement")}</h2>
      <DataTable columns={episodeColumns} rows={episodes} emptyTitle={t("emptyEpisodes")} />
      <Button
        className="mt-3"
        size="sm"
        variant="secondary"
        disabled={actionMut.isPending || episodes.length < 2}
        onClick={() =>
          act(() => adminReorderEpisodes(id, [...episodes].reverse().map((episode) => String(episode.id))))
        }
      >
        {t("reverseEpisodeOrder")}
      </Button>

      <ConfirmModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        message={t("confirmDeleteDrama")}
        busy={actionMut.isPending}
      />
    </>
  );
}

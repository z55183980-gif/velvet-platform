"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminApproveDrama,
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
import { Button, DataTable, Input, StatCard, fmtNum, type Column } from "@velvet/ui";
import { AdminShell } from "@/components/admin-shell";

type Episode = { id: string | number; episodeNumber?: number; title?: string; isFree?: boolean; priceCredits?: number; transcodeStatus?: string; thumbnailUrl?: string };
type Drama = {
  id: string | number; titleZh?: string; titleVi?: string; slug?: string; status?: string; coverUrl?: string;
  descriptionZh?: string; descriptionVi?: string; isFeatured?: boolean; isOfficial?: boolean; sortWeight?: number;
  freeEpisodeCount?: number; viewCount?: number; unlockCount?: number; favoriteCount?: number;
  creator?: { displayName?: string }; category?: { nameZh?: string; nameVi?: string }; episodes?: Episode[];
};

export default function AdminContentDetailPage() {
  const id = String(useParams().id);
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [weight, setWeight] = useState(0);
  const [freeEpisodes, setFreeEpisodes] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const detailQ = useQuery({
    queryKey: ["admin", "drama", id],
    queryFn: () => adminGetDrama(id) as Promise<Drama>,
  });
  useEffect(() => {
    if (!detailQ.data) return;
    setWeight(detailQ.data.sortWeight ?? 0);
    setFreeEpisodes(detailQ.data.freeEpisodeCount ?? 3);
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

  const episodeColumns: Column<Episode>[] = [
    { key: "number", header: "集数", cell: (episode) => String(episode.episodeNumber ?? "—") },
    { key: "title", header: "标题", cell: (episode) => (
      <Input defaultValue={episode.title || ""} onBlur={(e) => e.target.value !== (episode.title || "") && act(() => adminUpdateEpisode(String(episode.id), { title: e.target.value }))} />
    ) },
    { key: "free", header: "免费", cell: (episode) => (
      <input type="checkbox" defaultChecked={!!episode.isFree} onChange={(e) => act(() => adminUpdateEpisode(String(episode.id), { isFree: e.target.checked }))} />
    ) },
    { key: "credits", header: "积分", cell: (episode) => (
      <Input type="number" className="w-24" defaultValue={Number(episode.priceCredits || 0)} onBlur={(e) => Number(e.target.value) !== Number(episode.priceCredits || 0) && act(() => adminUpdateEpisode(String(episode.id), { priceCredits: Number(e.target.value) }))} />
    ) },
    { key: "transcode", header: "转码", cell: (episode) => <span className={episode.transcodeStatus === "FAILED" ? "text-danger" : ""}>{episode.transcodeStatus || "—"}</span> },
    { key: "thumbnail", header: "封面 URL", cell: (episode) => (
      <Input className="w-48" defaultValue={episode.thumbnailUrl || ""} onBlur={(e) => e.target.value !== (episode.thumbnailUrl || "") && act(() => adminUpdateEpisode(String(episode.id), { thumbnailUrl: e.target.value }))} />
    ) },
    { key: "actions", header: "", cell: (episode) => ["FAILED", "PENDING"].includes(episode.transcodeStatus || "") ? (
      <Button size="sm" variant="ghost" disabled={actionMut.isPending} onClick={() => act(() => adminRetryTranscode(String(episode.id)))}>重试转码</Button>
    ) : null },
  ];

  return (
    <AdminShell title={drama?.titleZh || drama?.titleVi || "短剧详情"}>
      <Link href="/content" className="mb-4 inline-block text-body-sm text-ink-muted hover:text-ink">← 返回列表</Link>
      {error || detailQ.error ? <p className="mb-3 text-body-sm text-danger">{error || (detailQ.error as Error).message}</p> : null}
      {detailQ.isLoading ? <p className="text-ink-muted">加载中…</p> : null}
      {drama ? (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-4">
            <StatCard label="浏览" value={fmtNum(drama.viewCount)} />
            <StatCard label="解锁" value={fmtNum(drama.unlockCount)} />
            <StatCard label="收藏" value={fmtNum(drama.favoriteCount)} />
            <StatCard label="分集" value={episodes.length} />
          </div>
          <div className="mb-8 grid gap-6 lg:grid-cols-[200px_1fr]">
            {drama.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={drama.coverUrl} alt="" className="aspect-[3/4] w-full rounded-lg bg-surface-2 object-cover" />
            ) : <div className="aspect-[3/4] rounded-lg bg-surface-2" />}
            <div className="space-y-3 text-body-sm">
              <p>slug {drama.slug} · 状态 <strong>{drama.status}</strong></p>
              <p>创作者 {drama.creator?.displayName || "—"} · 分类 {drama.category?.nameZh || drama.category?.nameVi || "—"}</p>
              <p className="whitespace-pre-wrap text-ink-muted">{drama.descriptionZh || drama.descriptionVi}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Input className="w-64" placeholder="操作理由（上下架必填）" value={reason} onChange={(e) => setReason(e.target.value)} />
                {drama.status === "PENDING_REVIEW" ? (
                  <>
                    <Button size="sm" disabled={actionMut.isPending} onClick={() => act(() => adminApproveDrama(id))}>审核通过</Button>
                    <Button size="sm" variant="danger" disabled={actionMut.isPending} onClick={() => act(() => adminRejectDrama(id, reason || "rejected"))}>拒绝</Button>
                  </>
                ) : null}
                {drama.status === "LIVE" ? <Button size="sm" variant="danger" disabled={actionMut.isPending} onClick={() => act(() => adminOfflineDrama(id, reason))}>强制下架</Button> : null}
                {["OFFLINE", "REJECTED"].includes(drama.status || "") ? <Button size="sm" disabled={actionMut.isPending} onClick={() => act(() => adminOnlineDrama(id, reason))}>恢复上架</Button> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <Button size="sm" variant="secondary" onClick={() => act(() => adminSetFeatured(id, !drama.isFeatured))}>推荐：{drama.isFeatured ? "开" : "关"}</Button>
                <Button size="sm" variant="secondary" onClick={() => act(() => adminSetOfficial(id, !drama.isOfficial))}>官方：{drama.isOfficial ? "开" : "关"}</Button>
                <Input type="number" className="w-24" value={weight} onChange={(e) => setWeight(Number(e.target.value))} />
                <Button size="sm" variant="secondary" onClick={() => act(() => adminSetSortWeight(id, weight))}>保存权重</Button>
                <Input type="number" className="w-24" value={freeEpisodes} onChange={(e) => setFreeEpisodes(Number(e.target.value))} />
                <Button size="sm" variant="secondary" onClick={() => act(() => adminUpdateDrama(id, { freeEpisodeCount: freeEpisodes }))}>保存免费集数</Button>
              </div>
            </div>
          </div>
          <h2 className="mb-3 text-h4">分集管理</h2>
          <DataTable columns={episodeColumns} rows={episodes} emptyTitle="暂无分集" />
          <Button className="mt-3" size="sm" variant="secondary" disabled={actionMut.isPending || episodes.length < 2} onClick={() => act(() => adminReorderEpisodes(id, [...episodes].reverse().map((episode) => String(episode.id))))}>
            反转分集顺序
          </Button>
        </>
      ) : null}
    </AdminShell>
  );
}

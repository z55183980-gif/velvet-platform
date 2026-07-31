"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useLocale } from "@/lib/i18n";
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
} from "@/lib/api";
import { AdminLayout, fmtNum } from "@/components/admin/AdminLayout";
import { buttonVariants } from "@/components/ui/button";
import { adminPath } from "@/lib/admin-path";

export default function AdminContentDetailPage() {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const params = useParams();
  const id = String(params.id);
  const [drama, setDrama] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [weight, setWeight] = useState(0);
  const [freeEp, setFreeEp] = useState(3);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const d = await adminGetDrama(id);
      setDrama(d);
      setWeight(d.sortWeight ?? 0);
      setFreeEp(d.freeEpisodeCount ?? 3);
    } catch (e: any) {
      setErr(e?.message || "failed");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(fn: () => Promise<any>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await load();
    } catch (e: any) {
      setErr(e?.message || "failed");
    } finally {
      setBusy(false);
    }
  }

  if (!drama && !err) {
    return (
      <AdminLayout title="…">
        <p className="text-ink-muted">{zh ? "加载中…" : "Đang tải…"}</p>
      </AdminLayout>
    );
  }

  const eps: any[] = drama?.episodes || [];

  return (
    <AdminLayout title={zh ? drama?.titleZh || drama?.titleVi : drama?.titleVi}>
      <div className="mb-4">
        <Link href={adminPath("/content")} className="text-body-sm text-ink-muted hover:text-ink">
          ← {zh ? "返回列表" : "Quay lại"}
        </Link>
      </div>
      {err ? <p className="text-danger text-body-sm mb-3">{err}</p> : null}

      <div className="grid lg:grid-cols-[200px_1fr] gap-6 mb-8">
        {drama?.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={drama.coverUrl} alt="" className="rounded-lg w-full aspect-[3/4] object-cover bg-surface-2" />
        ) : (
          <div className="rounded-lg bg-surface-2 aspect-[3/4]" />
        )}
        <div className="space-y-3 text-body-sm">
          <p>
            <span className="text-ink-muted">slug</span> {drama?.slug} · <span className="text-ink-muted">status</span>{" "}
            <strong>{drama?.status}</strong>
          </p>
          <p>
            <span className="text-ink-muted">{zh ? "创作者" : "Creator"}</span> {drama?.creator?.displayName} ·{" "}
            {drama?.category?.nameVi}
          </p>
          <p>
            views {fmtNum(drama?.viewCount)} · unlock {fmtNum(drama?.unlockCount)} · fav{" "}
            {fmtNum(drama?.favoriteCount)} · eps {eps.length}
          </p>
          <p className="text-ink-muted whitespace-pre-wrap">{zh ? drama?.descriptionZh : drama?.descriptionVi}</p>

          <div className="flex flex-wrap gap-2 items-center pt-2">
            <input
              className="rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-64"
              placeholder={zh ? "操作理由（上下架必填）" : "Lý do (bắt buộc khi online/offline)"}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            {drama?.status === "PENDING_REVIEW" ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  className={buttonVariants({ size: "sm" })}
                  onClick={() => act(() => adminApproveDrama(id))}
                >
                  {zh ? "通过" : "Duyệt"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className={buttonVariants({ variant: "secondary", size: "sm" })}
                  onClick={() => act(() => adminRejectDrama(id, reason || "rejected"))}
                >
                  {zh ? "拒绝" : "Từ chối"}
                </button>
              </>
            ) : null}
            {drama?.status === "LIVE" ? (
              <button
                type="button"
                disabled={busy}
                className={buttonVariants({ variant: "secondary", size: "sm" })}
                onClick={() => act(() => adminOfflineDrama(id, reason))}
              >
                {zh ? "强制下架" : "OFFLINE"}
              </button>
            ) : null}
            {drama?.status === "OFFLINE" || drama?.status === "REJECTED" ? (
              <button
                type="button"
                disabled={busy}
                className={buttonVariants({ size: "sm" })}
                onClick={() => act(() => adminOnlineDrama(id, reason))}
              >
                {zh ? "恢复上架" : "LIVE"}
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2 items-center pt-2 border-t border-line">
            <button
              type="button"
              disabled={busy}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
              onClick={() => act(() => adminSetFeatured(id, !drama.isFeatured))}
            >
              Featured: {drama?.isFeatured ? "ON" : "OFF"}
            </button>
            <button
              type="button"
              disabled={busy}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
              onClick={() => act(() => adminSetOfficial(id, !drama.isOfficial))}
            >
              Official: {drama?.isOfficial ? "ON" : "OFF"}
            </button>
            <input
              type="number"
              className="rounded-md bg-surface-2 border border-line px-2 py-1 w-24 text-body-sm"
              value={weight}
              onChange={(e) => setWeight(Number(e.target.value))}
            />
            <button
              type="button"
              disabled={busy}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
              onClick={() => act(() => adminSetSortWeight(id, weight))}
            >
              {zh ? "保存权重" : "Lưu weight"}
            </button>
            <input
              type="number"
              className="rounded-md bg-surface-2 border border-line px-2 py-1 w-24 text-body-sm"
              value={freeEp}
              onChange={(e) => setFreeEp(Number(e.target.value))}
            />
            <button
              type="button"
              disabled={busy}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
              onClick={() => act(() => adminUpdateDrama(id, { freeEpisodeCount: freeEp }))}
            >
              {zh ? "免费集数" : "Free eps"}
            </button>
          </div>
        </div>
      </div>

      <h2 className="text-h4 mb-3">{zh ? "分集管理" : "Tập phim"}</h2>
      <div className="overflow-x-auto rounded-lg border border-line mb-3">
        <table className="w-full text-body-sm">
          <thead className="bg-surface-2 text-ink-muted text-left">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">{zh ? "标题" : "Tiêu đề"}</th>
              <th className="px-3 py-2">Free</th>
              <th className="px-3 py-2">Credits</th>
              <th className="px-3 py-2">Transcode</th>
              <th className="px-3 py-2">{zh ? "封面" : "Thumb"}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {eps.map((ep) => (
              <tr key={String(ep.id)} className="border-t border-line">
                <td className="px-3 py-2 tabular-nums">{ep.episodeNumber}</td>
                <td className="px-3 py-2">
                  <input
                    className="w-full rounded bg-surface-2 border border-line px-2 py-1"
                    defaultValue={ep.title || ""}
                    onBlur={(e) => {
                      if (e.target.value !== (ep.title || "")) {
                        act(() => adminUpdateEpisode(String(ep.id), { title: e.target.value }));
                      }
                    }}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    defaultChecked={!!ep.isFree}
                    onChange={(e) =>
                      act(() => adminUpdateEpisode(String(ep.id), { isFree: e.target.checked }))
                    }
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    className="w-20 rounded bg-surface-2 border border-line px-2 py-1"
                    defaultValue={Number(ep.priceCredits || 0)}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v !== Number(ep.priceCredits || 0)) {
                        act(() => adminUpdateEpisode(String(ep.id), { priceCredits: v }));
                      }
                    }}
                  />
                </td>
                <td className="px-3 py-2">
                  <span className={ep.transcodeStatus === "FAILED" ? "text-danger" : ""}>
                    {ep.transcodeStatus}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <input
                    className="w-40 rounded bg-surface-2 border border-line px-2 py-1 text-caption"
                    defaultValue={ep.thumbnailUrl || ""}
                    placeholder="thumbnail URL"
                    onBlur={(e) => {
                      if (e.target.value !== (ep.thumbnailUrl || "")) {
                        act(() => adminUpdateEpisode(String(ep.id), { thumbnailUrl: e.target.value }));
                      }
                    }}
                  />
                </td>
                <td className="px-3 py-2">
                  {ep.transcodeStatus === "FAILED" || ep.transcodeStatus === "PENDING" ? (
                    <button
                      type="button"
                      disabled={busy}
                      className={buttonVariants({ variant: "ghost", size: "sm" })}
                      onClick={() => act(() => adminRetryTranscode(String(ep.id)))}
                    >
                      Retry
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        disabled={busy || eps.length < 2}
        className={buttonVariants({ variant: "secondary", size: "sm" })}
        onClick={() =>
          act(() =>
            adminReorderEpisodes(
              id,
              [...eps].reverse().map((e) => String(e.id)),
            ),
          )
        }
      >
        {zh ? "反转集顺序（演示重排）" : "Đảo thứ tự tập (demo reorder)"}
      </button>
    </AdminLayout>
  );
}

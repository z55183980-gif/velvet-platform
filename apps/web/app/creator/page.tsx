"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-context";
import { useLocale } from "@/lib/i18n";
import { buttonVariants } from "@/components/ui/button";
import { API_BASE, ApiError } from "@/lib/api";
import { formatApiError, useToast } from "@/components/toast";
import { track } from "@/lib/track";
import { categories, categoryName } from "@/lib/mock-data";

async function creatorApi<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("dv_token");
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}/creator${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.code !== 0) {
    throw new ApiError(
      res.status || json.code || 500,
      formatApiError({ message: json.message }, `HTTP ${res.status}`),
    );
  }
  return json.data as T;
}

export default function CreatorPage() {
  const { user, openLogin, ready } = useAuth();
  const { locale } = useLocale();
  const toast = useToast();
  const zh = locale === "zh";
  const [dash, setDash] = useState<any>(null);
  const [dramas, setDramas] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [titleEn, setTitleEn] = useState("");
  const [titleZh, setTitleZh] = useState("");
  const [categorySlug, setCategorySlug] = useState("ngon_tinh");
  const [withdrawAmount, setWithdrawAmount] = useState("100000");
  const [busy, setBusy] = useState(false);
  const [epDramaId, setEpDramaId] = useState("");
  const [epNo, setEpNo] = useState("4");
  const [epPrice, setEpPrice] = useState("11000");
  const [epHls, setEpHls] = useState("");
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [kyc, setKyc] = useState<any>(null);
  const [cccdNumber, setCccdNumber] = useState("");
  const [taxCode, setTaxCode] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccountNo, setBankAccountNo] = useState("");
  const [bankHolder, setBankHolder] = useState("");
  const [cccdFrontUrl, setCccdFrontUrl] = useState("");
  const [cccdBackUrl, setCccdBackUrl] = useState("");
  const [kycDocBusy, setKycDocBusy] = useState(false);
  const [kycDocMsg, setKycDocMsg] = useState<string | null>(null);
  const [daily, setDaily] = useState<{ day: string; totalVnd: string; orders: number }[]>([]);
  const [earnDays, setEarnDays] = useState<7 | 30>(7);

  const CATEGORIES = categories.map((c) => ({
    slug: c.slug,
    label: categoryName(c.slug, locale),
  }));

  const fail = useCallback(
    (e: unknown, fallback: string) => {
      const msg = formatApiError(e, fallback);
      setErr(msg);
      toast.error(msg);
    },
    [toast],
  );

  const reload = useCallback(async () => {
    if (!user) return;
    setErr(null);
    try {
      const [d, list, k, earn] = await Promise.all([
        creatorApi<any>("/dashboard"),
        creatorApi<any[]>("/dramas"),
        creatorApi<any>("/kyc/status"),
        creatorApi<{ rows: { day: string; totalVnd: string; orders: number }[] }>(
          `/earnings/daily?days=${earnDays}`,
        ),
      ]);
      setDash(d);
      setDramas(list || []);
      setKyc(k);
      setDaily(earn?.rows || []);
    } catch (e: any) {
      fail(e, "error");
    }
  }, [user, earnDays, fail]);

  useEffect(() => {
    if (ready && user) reload();
  }, [ready, user, reload]);

  async function createDrama() {
    if (!titleEn.trim()) return;
    setBusy(true);
    try {
      await creatorApi("/dramas", {
        method: "POST",
        body: JSON.stringify({ titleEn, titleZh: titleZh || titleEn, categorySlug }),
      });
      track("create_drama", { categorySlug });
      setTitleEn("");
      setTitleZh("");
      await reload();
    } catch (e: any) {
      fail(e, "create failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitReview(id: string) {
    setBusy(true);
    try {
      await creatorApi(`/dramas/${id}/submit-review`, { method: "POST", body: "{}" });
      track("submit_drama", { dramaId: id });
      await reload();
    } catch (e: any) {
      fail(e, "submit failed");
    } finally {
      setBusy(false);
    }
  }

  async function patchDrama(id: string) {
    const title = window.prompt(zh ? "新标题 (VI)" : "Tiêu đề VI");
    if (!title?.trim()) return;
    setBusy(true);
    try {
      await creatorApi(`/dramas/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ titleEn: title.trim() }),
      });
      await reload();
    } catch (e: any) {
      fail(e, "update failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeDrama(id: string) {
    if (!window.confirm(zh ? "仅草稿可删，确认？" : "Chỉ xoá DRAFT. Xác nhận?")) return;
    setBusy(true);
    try {
      await creatorApi(`/dramas/${id}`, { method: "DELETE" });
      await reload();
    } catch (e: any) {
      fail(e, "delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function offlineDrama(id: string) {
    if (!window.confirm(zh ? "确认下架？" : "Gỡ phim?")) return;
    setBusy(true);
    try {
      await creatorApi(`/dramas/${id}/offline`, { method: "POST", body: "{}" });
      await reload();
    } catch (e: any) {
      fail(e, "offline failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeEpisode(id: string) {
    if (!window.confirm(zh ? "仅草稿剧集可删，确认？" : "Chỉ xoá tập DRAFT?")) return;
    setBusy(true);
    try {
      await creatorApi(`/episodes/${id}`, { method: "DELETE" });
      await reload();
    } catch (e: any) {
      fail(e, "delete ep failed");
    } finally {
      setBusy(false);
    }
  }

  async function addEpisode() {
    if (!epDramaId) return;
    setBusy(true);
    try {
      const ep = await creatorApi<any>(`/dramas/${epDramaId}/episodes`, {
        method: "POST",
        body: JSON.stringify({
          episodeNumber: Number(epNo),
          title: `Episode ${epNo}`,
          isFree: Number(epNo) <= 3,
          priceVnd: Number(epPrice),
          priceCredits: Number(epPrice),
          hlsUrl: epHls || undefined,
          originalUrl: epHls || undefined,
        }),
      });
      // 若已上传 mp4 路径，触发转码
      if (epHls && !epHls.endsWith(".m3u8") && ep?.id) {
        try {
          await creatorApi("/transcode", {
            method: "POST",
            body: JSON.stringify({ relativePath: epHls, episodeId: String(ep.id) }),
          });
        } catch {
          /* 转码可选 */
        }
      }
      await reload();
    } catch (e: any) {
      fail(e, "episode failed");
    } finally {
      setBusy(false);
    }
  }

  async function onUploadFile(file: File | null) {
    if (!file) return;
    setUploadBusy(true);
    setUploadStatus(zh ? "上传中…" : "Đang tải lên…");
    setErr(null);
    try {
      const headers: Record<string, string> = {};
      const token = localStorage.getItem("dv_token");
      if (token) headers.Authorization = `Bearer ${token}`;
      const fd = new FormData();
      fd.append("file", file);
      fd.append("transcode", "1");
      const res = await fetch(`${API_BASE}/creator/upload`, {
        method: "POST",
        credentials: "include",
        headers,
        body: fd,
      });
      const json = await res.json();
      if (!res.ok || json.code !== 0) throw new ApiError(res.status, json.message || "upload fail");
      const path = json.data?.relativePath as string;
      setEpHls(path || "");
      setUploadStatus(
        zh
          ? `已上传: ${path}${json.data?.jobId ? ` · 转码任务 ${json.data.jobId}` : ""}`
          : `OK: ${path}`,
      );
      if (json.data?.jobId) {
        // 轮询转码状态
        const jobId = json.data.jobId as string;
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          try {
            const st = await creatorApi<any>(`/transcode/${jobId}`);
            setUploadStatus(
              zh
                ? `转码: ${st.status}${st.outputRel ? ` → ${st.outputRel}` : ""}`
                : `Transcode: ${st.status}`,
            );
            if (st.status === "completed") {
              if (st.outputRel) setEpHls(st.outputRel);
              break;
            }
            if (st.status === "failed") {
              fail(st.error || "transcode failed", "transcode failed");
              break;
            }
          } catch {
            break;
          }
        }
      }
    } catch (e: any) {
      fail(e, "upload failed");
      setUploadStatus(null);
    } finally {
      setUploadBusy(false);
    }
  }

  async function withdraw() {
    setBusy(true);
    try {
      await creatorApi("/withdraws", {
        method: "POST",
        body: JSON.stringify({
          amountVnd: Number(withdrawAmount),
          bankInfo: {
            bank: bankName || "VCB",
            account: bankAccountNo || "000000",
            name: bankHolder || "Creator",
          },
        }),
      });
      await reload();
      toast.success(zh ? "提现已提交" : "Đã gửi yêu cầu rút");
    } catch (e: any) {
      fail(e, "withdraw failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitKyc() {
    if (!cccdNumber.trim() || !taxCode.trim() || !bankName.trim() || !bankAccountNo.trim() || !bankHolder.trim()) {
      fail(zh ? "请填写完整 KYC 信息" : "Vui lòng điền đủ thông tin KYC", "kyc incomplete");
      return;
    }
    setBusy(true);
    try {
      await creatorApi("/kyc/submit", {
        method: "POST",
        body: JSON.stringify({
          cccdNumber,
          cccdFrontUrl: cccdFrontUrl || undefined,
          cccdBackUrl: cccdBackUrl || undefined,
          faceVerified: true,
          taxCode,
          bankAccount: {
            bank: bankName,
            account: bankAccountNo,
            name: bankHolder,
          },
        }),
      });
      track("kyc_submit");
      await reload();
      toast.success(zh ? "KYC 已提交" : "Đã gửi KYC");
    } catch (e: any) {
      fail(e, "kyc failed");
    } finally {
      setBusy(false);
    }
  }

  async function uploadKycDoc(file: File, kind: "cccd-front" | "cccd-back") {
    setKycDocBusy(true);
    setKycDocMsg(zh ? "上传中…" : "Đang tải…");
    try {
      const headers: Record<string, string> = {};
      const token = localStorage.getItem("dv_token");
      if (token) headers.Authorization = `Bearer ${token}`;
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", kind);
      const res = await fetch(`${API_BASE}/creator/kyc-doc`, {
        method: "POST",
        credentials: "include",
        headers,
        body: fd,
      });
      const json = await res.json();
      if (!res.ok || json.code !== 0) {
        throw new ApiError(res.status, json.message || "upload fail");
      }
      const url = json.data?.relativePath as string;
      if (kind === "cccd-front") setCccdFrontUrl(url);
      else setCccdBackUrl(url);
      setKycDocMsg(zh ? `已上传 ${kind}: ${url}` : `OK ${kind}: ${url}`);
    } catch (e: any) {
      setKycDocMsg(`${zh ? "上传失败" : "Upload fail"}: ${e?.message || e}`);
    } finally {
      setKycDocBusy(false);
    }
  }

  if (!ready) {
    return <div className="mx-auto max-w-[960px] px-4 py-24 text-center text-ink-subtle">…</div>;
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-[960px] px-4 py-24 text-center md:px-6">
        <h1 className="text-h2 font-bold text-ink">{zh ? "创作者中心" : "Trung tâm sáng tạo"}</h1>
        <p className="mt-3 text-ink-muted">{zh ? "请先登录" : "Vui lòng đăng nhập"}</p>
        <button className={buttonVariants({ variant: "primary", size: "lg" }) + " mt-6"} onClick={() => openLogin()}>
          {zh ? "登录" : "Đăng nhập"}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[960px] px-4 py-10 md:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h2 font-bold text-ink">{zh ? "创作者中心" : "Trung tâm sáng tạo"}</h1>
          <p className="mt-1 text-body-sm text-ink-muted">/creator · KYC · 70/30 · T+7</p>
        </div>
        <Link href="/" className="text-body-sm text-ink-muted hover:text-ink">
          ← {zh ? "回首页" : "Về trang chủ"}
        </Link>
      </div>

      {err && (
        <p
          role="alert"
          className="sticky top-16 z-40 mt-4 rounded-md border border-danger/40 bg-surface px-3 py-2 text-caption text-danger shadow-2"
        >
          {err}
        </p>
      )}

      {dash && (
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            [zh ? "可提现 ₫" : "Khả dụng ₫", dash.availableVnd],
            [zh ? "冻结中 ₫" : "Chờ T+7 ₫", dash.pendingVnd],
            [zh ? "累计收益 ₫" : "Tổng thu ₫", dash.totalEarnedVnd],
            [zh ? "作品数" : "Phim", dash.dramas],
          ].map(([label, val]) => (
            <div key={String(label)} className="rounded-xl border border-line bg-surface-2 px-4 py-4">
              <div className="text-caption text-ink-subtle">{label}</div>
              <div className="mt-1 text-h4 font-semibold tabular-nums text-ink">
                {Number(val || 0).toLocaleString("vi-VN")}
              </div>
            </div>
          ))}
        </div>
      )}

      <section className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-h3 font-semibold text-ink">{zh ? "收益趋势" : "Doanh thu"}</h2>
          <div className="flex gap-2">
            {([7, 30] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setEarnDays(d)}
                className={`rounded-md px-2.5 py-1 text-xs ${
                  earnDays === d ? "bg-brand text-white" : "border border-line text-ink-muted"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
        <EarningsChart rows={daily} zh={zh} />
      </section>

      <section className="mt-10">
        <h2 className="text-h3 font-semibold text-ink">{zh ? "新建短剧" : "Tạo phim mới"}</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <input
            className="rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink"
            placeholder="Title (VI)"
            value={titleEn}
            onChange={(e) => setTitleEn(e.target.value)}
          />
          <input
            className="rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink"
            placeholder="Title (ZH)"
            value={titleZh}
            onChange={(e) => setTitleZh(e.target.value)}
          />
          <select
            className="rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink"
            value={categorySlug}
            onChange={(e) => setCategorySlug(e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label}
              </option>
            ))}
          </select>
          <button
            disabled={busy}
            className={buttonVariants({ variant: "primary" })}
            onClick={createDrama}
          >
            {zh ? "创建草稿" : "Tạo nháp"}
          </button>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-h3 font-semibold text-ink">KYC</h2>
        <p className="mt-1 text-caption text-ink-subtle">
          {zh ? "状态" : "Trạng thái"}: {kyc?.kycStatus ?? "…"}
        </p>
        {kyc?.kycStatus !== "APPROVED" && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <input
              className="rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink"
              placeholder="CCCD (9 or 12 digits)"
              value={cccdNumber}
              onChange={(e) => setCccdNumber(e.target.value)}
            />
            <input
              className="rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink"
              placeholder="Tax code"
              value={taxCode}
              onChange={(e) => setTaxCode(e.target.value)}
            />
            <input
              className="rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink"
              placeholder="Bank name (VCB / TPBank / …)"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
            />
            <input
              className="rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink"
              placeholder="Bank account #"
              value={bankAccountNo}
              onChange={(e) => setBankAccountNo(e.target.value)}
            />
            <input
              className="rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink sm:col-span-2"
              placeholder="Account holder name"
              value={bankHolder}
              onChange={(e) => setBankHolder(e.target.value)}
            />
            <label className="flex cursor-pointer items-center justify-center rounded-md border border-dashed border-line bg-surface px-3 py-2 text-body-sm text-ink-muted hover:text-ink">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={kycDocBusy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadKycDoc(f, "cccd-front");
                }}
              />
              {cccdFrontUrl
                ? `CCCD mặt trước: ${cccdFrontUrl}`
                : zh
                  ? "上传 CCCD 正面"
                  : "Upload CCCD mặt trước"}
            </label>
            <label className="flex cursor-pointer items-center justify-center rounded-md border border-dashed border-line bg-surface px-3 py-2 text-body-sm text-ink-muted hover:text-ink">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={kycDocBusy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadKycDoc(f, "cccd-back");
                }}
              />
              {cccdBackUrl
                ? `CCCD mặt sau: ${cccdBackUrl}`
                : zh
                  ? "上传 CCCD 反面"
                  : "Upload CCCD mặt sau"}
            </label>
            {kycDocMsg && (
              <p className="sm:col-span-2 text-caption text-ink-subtle">{kycDocMsg}</p>
            )}
            <button
              disabled={busy || kyc?.kycStatus === "PENDING"}
              className={buttonVariants({ variant: "primary" }) + " sm:col-span-2"}
              onClick={submitKyc}
            >
              {kyc?.kycStatus === "PENDING"
                ? zh
                  ? "已提交待审"
                  : "Đã gửi"
                : zh
                  ? "提交 KYC"
                  : "Gửi KYC"}
            </button>
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-h3 font-semibold text-ink">{zh ? "我的作品" : "Phim của tôi"}</h2>
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
          {dramas.length === 0 && (
            <li className="px-4 py-6 text-body-sm text-ink-subtle">{zh ? "暂无" : "Chưa có"}</li>
          )}
          {dramas.map((d) => (
            <li key={String(d.id)} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <div className="text-body font-medium text-ink">{d.titleEn}</div>
                <div className="text-caption text-ink-subtle">
                  {d.status} · {d._count?.episodes ?? 0} ep · {d.slug}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={busy}
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                  onClick={() => patchDrama(String(d.id))}
                >
                  {zh ? "编辑" : "Sửa"}
                </button>
                {d.status === "DRAFT" && (
                  <>
                    <button
                      disabled={busy}
                      className={buttonVariants({ variant: "secondary", size: "sm" })}
                      onClick={() => submitReview(String(d.id))}
                    >
                      {zh ? "提交审核" : "Gửi duyệt"}
                    </button>
                    <button
                      disabled={busy}
                      className={buttonVariants({ variant: "ghost", size: "sm" })}
                      onClick={() => removeDrama(String(d.id))}
                    >
                      {zh ? "删除" : "Xoá"}
                    </button>
                  </>
                )}
                {d.status === "LIVE" && (
                  <button
                    disabled={busy}
                    className={buttonVariants({ variant: "secondary", size: "sm" })}
                    onClick={() => offlineDrama(String(d.id))}
                  >
                    {zh ? "下架" : "Gỡ"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-h3 font-semibold text-ink">{zh ? "添加剧集" : "Thêm tập"}</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <select
            className="rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink"
            value={epDramaId}
            onChange={(e) => setEpDramaId(e.target.value)}
          >
            <option value="">{zh ? "选择短剧" : "Chọn phim"}</option>
            {dramas.map((d) => (
              <option key={String(d.id)} value={String(d.id)}>
                {d.titleEn}
              </option>
            ))}
          </select>
          <input
            className="rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink"
            placeholder="episode #"
            value={epNo}
            onChange={(e) => setEpNo(e.target.value)}
          />
          <input
            className="rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink"
            placeholder="priceCredits"
            value={epPrice}
            onChange={(e) => setEpPrice(e.target.value)}
          />
          <input
            className="rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink"
            placeholder="hlsUrl / uploads/… (relative)"
            value={epHls}
            onChange={(e) => setEpHls(e.target.value)}
          />
          <label className="flex cursor-pointer items-center justify-center rounded-md border border-dashed border-line bg-surface px-3 py-2 text-body-sm text-ink-muted hover:text-ink">
            <input
              type="file"
              accept="video/mp4,video/*,.mp4,.mov,.mkv,.webm"
              className="hidden"
              disabled={uploadBusy}
              onChange={(e) => onUploadFile(e.target.files?.[0] || null)}
            />
            {uploadBusy ? (zh ? "上传/转码中…" : "Uploading…") : zh ? "上传视频并转码" : "Upload + transcode"}
          </label>
          <button disabled={busy} className={buttonVariants({ variant: "primary" })} onClick={addEpisode}>
            {zh ? "添加剧集" : "Thêm tập"}
          </button>
        </div>
        {uploadStatus && <p className="mt-2 text-caption text-ink-subtle">{uploadStatus}</p>}
      </section>

      <section className="mt-10">
        <h2 className="text-h3 font-semibold text-ink">{zh ? "剧集转码状态" : "Trạng thái encode"}</h2>
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
          {dramas.flatMap((d) =>
            (d.episodes || []).map((ep: any) => (
              <li key={String(ep.id)} className="flex flex-wrap justify-between gap-2 px-4 py-3 text-body-sm">
                <span className="text-ink">
                  {d.titleEn} · ep{ep.episodeNumber}
                </span>
                <span className="flex items-center gap-3 text-ink-subtle">
                  {ep.transcodeStatus || "—"} · {ep.hlsUrl || ep.originalUrl || "no url"}
                  {d.status === "DRAFT" && (
                    <button
                      type="button"
                      className="text-xs text-ink-muted hover:text-red-400"
                      onClick={() => removeEpisode(String(ep.id))}
                    >
                      {zh ? "删除" : "Xoá"}
                    </button>
                  )}
                </span>
              </li>
            )),
          )}
          {dramas.every((d) => !d.episodes?.length) && (
            <li className="px-4 py-6 text-ink-subtle">{zh ? "暂无剧集" : "Trống"}</li>
          )}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-h3 font-semibold text-ink">{zh ? "申请提现" : "Rút tiền"}</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <input
            className="w-40 rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink"
            value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e.target.value)}
          />
          <button disabled={busy} className={buttonVariants({ variant: "primary" })} onClick={withdraw}>
            {zh ? "提交提现" : "Gửi yêu cầu"}
          </button>
        </div>
        <p className="mt-2 text-caption text-ink-subtle">
          {zh ? "需 T+7 解冻后 available 足够；最低门槛由后台配置。" : "Cần đủ available sau T+7."}
        </p>
      </section>
    </div>
  );
}

function EarningsChart({
  rows,
  zh,
}: {
  rows: { day: string; totalVnd: string; orders: number }[];
  zh: boolean;
}) {
  if (!rows.length) {
    return (
      <p className="mt-4 text-body-sm text-ink-muted">{zh ? "暂无数据" : "Chưa có dữ liệu"}</p>
    );
  }
  const vals = rows.map((r) => Number(r.totalVnd || 0));
  const max = Math.max(...vals, 1);
  const w = Math.max(320, rows.length * 18);
  const h = 120;
  const pad = 8;
  const points = vals
    .map((v, i) => {
      const x = pad + (i * (w - pad * 2)) / Math.max(rows.length - 1, 1);
      const y = h - pad - (v / max) * (h - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");
  const total = vals.reduce((a, b) => a + b, 0);
  return (
    <div className="mt-4 rounded-xl border border-line bg-surface-2 p-4">
      <p className="mb-2 text-caption text-ink-subtle">
        {zh ? "合计" : "Tổng"}: {total.toLocaleString("vi-VN")} ₫
      </p>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-32 w-full" role="img" aria-label="earnings">
        <polyline
          fill="none"
          stroke="var(--color-brand)"
          strokeWidth="2"
          points={points}
        />
        {vals.map((v, i) => {
          const x = pad + (i * (w - pad * 2)) / Math.max(rows.length - 1, 1);
          const y = h - pad - (v / max) * (h - pad * 2);
          return <circle key={rows[i].day} cx={x} cy={y} r="2.5" fill="var(--color-brand)" />;
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-ink-subtle">
        <span>{rows[0]?.day?.slice(5)}</span>
        <span>{rows[rows.length - 1]?.day?.slice(5)}</span>
      </div>
    </div>
  );
}

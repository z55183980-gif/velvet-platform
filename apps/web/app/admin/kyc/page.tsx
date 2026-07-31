"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import { adminApproveKyc, adminListKyc, adminRejectKyc } from "@/lib/api";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { buttonVariants } from "@/components/ui/button";

export default function AdminKycPage() {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const [status, setStatus] = useState("PENDING");
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const s = new URLSearchParams(window.location.search).get("status");
    if (s) setStatus(s);
  }, []);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const data = await adminListKyc({ status, page: 1, pageSize: 40 });
      setRows(data.rows || []);
    } catch (e: any) {
      setErr(e?.message || "failed");
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AdminLayout title={zh ? "KYC 审核" : "Duyệt KYC"}>
      {err ? <p className="text-danger text-body-sm mb-3">{err}</p> : null}
      <select
        className="mb-4 rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
      >
        {["ALL", "PENDING", "APPROVED", "REJECTED"].map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <div className="space-y-4">
        {rows.map((r) => (
          <div key={String(r.id)} className="rounded-lg border border-line bg-surface p-4">
            <div className="flex flex-wrap justify-between gap-2 mb-3">
              <div>
                <p className="font-medium">{r.displayName}</p>
                <p className="text-caption text-ink-muted">
                  {r.user?.email || r.user?.phone} · CCCD {r.cccdNumber || "—"} · {r.kycStatus}
                </p>
                {r.kycRejectReason ? (
                  <p className="text-caption text-danger mt-1">{r.kycRejectReason}</p>
                ) : null}
              </div>
              {r.kycStatus === "PENDING" ? (
                <div className="flex flex-wrap gap-2 items-center">
                  <button
                    type="button"
                    className={buttonVariants({ size: "sm" })}
                    onClick={async () => {
                      try {
                        await adminApproveKyc(String(r.id));
                        await load();
                      } catch (e: any) {
                        setErr(e?.message || "failed");
                      }
                    }}
                  >
                    {zh ? "通过" : "Duyệt"}
                  </button>
                  <input
                    className="w-40 rounded bg-surface-2 border border-line px-2 py-1 text-caption"
                    placeholder={zh ? "拒绝理由" : "Lý do từ chối"}
                    value={reasons[String(r.id)] || ""}
                    onChange={(e) =>
                      setReasons((m) => ({ ...m, [String(r.id)]: e.target.value }))
                    }
                  />
                  <button
                    type="button"
                    className={buttonVariants({ variant: "secondary", size: "sm" })}
                    onClick={async () => {
                      try {
                        await adminRejectKyc(String(r.id), reasons[String(r.id)] || "");
                        await load();
                      } catch (e: any) {
                        setErr(e?.message || "failed");
                      }
                    }}
                  >
                    {zh ? "拒绝" : "Từ chối"}
                  </button>
                </div>
              ) : null}
            </div>
            <div className="flex gap-3 flex-wrap">
              {[
                { url: r.cccdFrontUrl, label: zh ? "正面" : "Mặt trước" },
                { url: r.cccdBackUrl, label: zh ? "背面" : "Mặt sau" },
              ].map((d) =>
                d.url ? (
                  <button
                    key={d.label}
                    type="button"
                    className="text-left"
                    onClick={() => setPreview(d.url)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={d.url}
                      alt={d.label}
                      className="h-28 w-44 object-cover rounded border border-line bg-surface-2"
                    />
                    <span className="block text-caption text-ink-muted mt-1">{d.label}</span>
                  </button>
                ) : (
                  <div
                    key={d.label}
                    className="h-28 w-44 rounded border border-dashed border-line flex items-center justify-center text-caption text-ink-muted"
                  >
                    {d.label}: —
                  </div>
                ),
              )}
            </div>
          </div>
        ))}
      </div>

      {preview ? (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6"
          onClick={() => setPreview(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="" className="max-h-full max-w-full rounded-lg" />
        </div>
      ) : null}
    </AdminLayout>
  );
}

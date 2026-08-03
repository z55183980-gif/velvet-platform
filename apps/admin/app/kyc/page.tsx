"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApproveKyc, adminListKyc, adminRejectKyc, asRows } from "@velvet/api-client";
import { AdminShell } from "@/components/admin-shell";
import { t } from "@/lib/i18n";
import { Button, EmptyState, Input, Select, Skeleton } from "@velvet/ui";

type Row = {
  id: string | number;
  displayName?: string;
  cccdNumber?: string;
  kycStatus?: string;
  kycRejectReason?: string | null;
  cccdFrontUrl?: string | null;
  cccdBackUrl?: string | null;
  user?: { email?: string | null; phone?: string | null };
};

export default function AdminKycPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("PENDING");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("status");
    if (s) setStatus(s);
  }, []);

  const listQ = useQuery({
    queryKey: ["admin", "kyc", status],
    queryFn: async () => asRows<Row>(await adminListKyc({ status, page: 1, pageSize: 40 })),
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => adminApproveKyc(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "kyc"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => adminRejectKyc(id, reason),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "kyc"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const rows = listQ.data || [];

  return (
    <AdminShell title={t("kyc")}>
      {err || listQ.error ? (
        <p className="mb-3 text-body-sm text-danger">{err || (listQ.error as Error).message}</p>
      ) : null}

      <Select className="mb-4 w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
        {["ALL", "PENDING", "APPROVED", "REJECTED"].map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </Select>

      {listQ.isFetching && !rows.length ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      ) : !rows.length ? (
        <EmptyState title={t("empty")} />
      ) : (
        <div className="space-y-4">
          {rows.map((r) => (
            <div key={String(r.id)} className="rounded-lg border border-line bg-surface p-4">
              <div className="mb-3 flex flex-wrap justify-between gap-2">
                <div>
                  <p className="font-medium">{r.displayName}</p>
                  <p className="text-caption text-ink-muted">
                    {r.user?.email || r.user?.phone} · CCCD {r.cccdNumber || "—"} · {r.kycStatus}
                  </p>
                  {r.kycRejectReason ? (
                    <p className="mt-1 text-caption text-danger">{r.kycRejectReason}</p>
                  ) : null}
                </div>
                {r.kycStatus === "PENDING" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={() => approveMut.mutate(String(r.id))}>
                      {t("approve")}
                    </Button>
                    <Input
                      className="w-40"
                      placeholder="拒绝理由"
                      value={reasons[String(r.id)] || ""}
                      onChange={(e) => setReasons((m) => ({ ...m, [String(r.id)]: e.target.value }))}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        rejectMut.mutate({
                          id: String(r.id),
                          reason: reasons[String(r.id)] || "",
                        })
                      }
                    >
                      {t("reject")}
                    </Button>
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-3">
                {[
                  { url: r.cccdFrontUrl, label: "正面" },
                  { url: r.cccdBackUrl, label: "背面" },
                ].map((d) =>
                  d.url ? (
                    <button key={d.label} type="button" className="text-left" onClick={() => setPreview(d.url!)}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={d.url}
                        alt={d.label}
                        className="h-28 w-44 rounded border border-line bg-surface-2 object-cover"
                      />
                      <span className="mt-1 block text-caption text-ink-muted">{d.label}</span>
                    </button>
                  ) : (
                    <div
                      key={d.label}
                      className="flex h-28 w-44 items-center justify-center rounded border border-dashed border-line text-caption text-ink-muted"
                    >
                      {d.label}: —
                    </div>
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {preview ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setPreview(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="" className="max-h-full max-w-full rounded-lg" />
        </div>
      ) : null}
    </AdminShell>
  );
}

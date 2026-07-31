"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import { adminListAuditLogs } from "@/lib/api";
import { AdminLayout, fmtDate } from "@/components/admin/AdminLayout";
import { buttonVariants } from "@/components/ui/button";

export default function AdminAuditPage() {
  const { locale, t } = useLocale();
  const zh = locale === "zh";
  const [action, setAction] = useState("");
  const [targetType, setTargetType] = useState("");
  const [actorId, setActorId] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const data = await adminListAuditLogs({
        action: action || undefined,
        targetType: targetType || undefined,
        actorId: actorId || undefined,
        page: 1,
        pageSize: 50,
      });
      setRows(data.rows || data || []);
    } catch (e: any) {
      setErr(e?.message || "failed");
    }
  }, [action, targetType, actorId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AdminLayout title={t("admin.audit")}>
      {err ? <p className="text-danger text-body-sm mb-3">{err}</p> : null}
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          className="rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-40"
          placeholder="action"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        />
        <input
          className="rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-36"
          placeholder="targetType"
          value={targetType}
          onChange={(e) => setTargetType(e.target.value)}
        />
        <input
          className="rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-28"
          placeholder="actorId"
          value={actorId}
          onChange={(e) => setActorId(e.target.value)}
        />
        <button type="button" className={buttonVariants({ size: "sm" })} onClick={load}>
          {t("admin.filter")}
        </button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-body-sm">
          <thead className="bg-surface-2 text-ink-muted text-left">
            <tr>
              <th className="px-3 py-2">{t("admin.time")}</th>
              <th className="px-3 py-2">Actor</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Target</th>
              <th className="px-3 py-2">Result</th>
              <th className="px-3 py-2">Payload</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-ink-muted">
                  {t("admin.empty")}
                </td>
              </tr>
            ) : null}
            {rows.map((r) => (
              <tr key={String(r.id)} className="border-t border-line">
                <td className="px-3 py-2 text-caption whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                <td className="px-3 py-2">{r.actorId != null ? String(r.actorId) : "system"}</td>
                <td className="px-3 py-2">{r.action}</td>
                <td className="px-3 py-2 text-caption">
                  {r.targetType}/{r.targetId}
                </td>
                <td className="px-3 py-2">{r.result}</td>
                <td className="px-3 py-2 text-caption font-mono max-w-md truncate">
                  {JSON.stringify(r.payload)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminLayout>
  );
}

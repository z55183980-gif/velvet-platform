"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import {
  adminListAdmins,
  adminListSettings,
  adminSetAdminRole,
  adminUpdateSetting,
} from "@/lib/api";
import { AdminLayout, fmtDate } from "@/components/admin/AdminLayout";
import { buttonVariants } from "@/components/ui/button";

export default function AdminSettingsPage() {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const [items, setItems] = useState<any[]>([]);
  const [admins, setAdmins] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [s, a] = await Promise.all([adminListSettings(), adminListAdmins().catch(() => [])]);
      setItems(s.items || []);
      setAdmins(a || []);
      const d: Record<string, string> = {};
      for (const it of s.items || []) {
        d[it.key] = typeof it.value === "string" ? it.value : JSON.stringify(it.value);
      }
      setDrafts(d);
    } catch (e: any) {
      setErr(e?.message || "failed");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function parseValue(it: any, raw: string) {
    if (it.type === "boolean") return raw === "true" || raw === "1";
    if (it.type === "number") return Number(raw);
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  return (
    <AdminLayout title={zh ? "系统设置" : "Cài đặt hệ thống"}>
      {err ? <p className="text-danger text-body-sm mb-3">{err}</p> : null}
      <div className="space-y-3 mb-10">
        {items.map((it) => (
          <div
            key={it.key}
            className="rounded-lg border border-line bg-surface p-4 flex flex-wrap gap-3 items-center justify-between"
          >
            <div>
              <p className="font-medium text-body-sm">{zh ? it.labelZh : it.labelVi}</p>
              <p className="text-caption text-ink-muted font-mono">{it.key}</p>
              {it.updatedAt ? (
                <p className="text-caption text-ink-muted">{fmtDate(it.updatedAt)}</p>
              ) : null}
            </div>
            <div className="flex gap-2 items-center">
              {it.type === "boolean" ? (
                <select
                  className="rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm"
                  value={drafts[it.key] ?? String(it.value)}
                  onChange={(e) => setDrafts((d) => ({ ...d, [it.key]: e.target.value }))}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input
                  className="rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-40"
                  value={drafts[it.key] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [it.key]: e.target.value }))}
                />
              )}
              <button
                type="button"
                className={buttonVariants({ size: "sm" })}
                onClick={async () => {
                  try {
                    await adminUpdateSetting(it.key, parseValue(it, drafts[it.key]));
                    await load();
                  } catch (e: any) {
                    setErr(e?.message || "failed");
                  }
                }}
              >
                {zh ? "保存" : "Lưu"}
              </button>
            </div>
          </div>
        ))}
      </div>

      <h2 className="text-h4 mb-3">{zh ? "管理员角色" : "Vai trò admin"}</h2>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-body-sm">
          <thead className="bg-surface-2 text-ink-muted text-left">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {admins.map((a) => (
              <tr key={String(a.id)} className="border-t border-line">
                <td className="px-3 py-2">{String(a.id)}</td>
                <td className="px-3 py-2">
                  {a.username} · {a.email}
                </td>
                <td className="px-3 py-2">{a.role}</td>
                <td className="px-3 py-2">{a.status}</td>
                <td className="px-3 py-2 space-x-2">
                  <button
                    type="button"
                    className={buttonVariants({ variant: "ghost", size: "sm" })}
                    onClick={async () => {
                      try {
                        await adminSetAdminRole(String(a.id), "SUPER_ADMIN");
                        await load();
                      } catch (e: any) {
                        setErr(e?.message || "failed");
                      }
                    }}
                  >
                    SUPER_ADMIN
                  </button>
                  <button
                    type="button"
                    className={buttonVariants({ variant: "secondary", size: "sm" })}
                    onClick={async () => {
                      try {
                        await adminSetAdminRole(String(a.id), "OPS");
                        await load();
                      } catch (e: any) {
                        setErr(e?.message || "failed");
                      }
                    }}
                  >
                    OPS
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminLayout>
  );
}

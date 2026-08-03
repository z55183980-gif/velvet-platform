"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminListAdmins,
  adminListSettings,
  adminSetAdminRole,
  adminUpdateSetting,
} from "@velvet/api-client";
import { Button, DataTable, Input, Select, fmtDate, type Column } from "@velvet/ui";
import { AdminShell } from "@/components/admin-shell";
import { t } from "@/lib/i18n";

type Setting = { key: string; value: unknown; type?: string; labelZh?: string; labelVi?: string; updatedAt?: string };
type Admin = { id: string | number; username?: string; email?: string; role?: string; status?: string };

function parseValue(setting: Setting, raw: string) {
  if (setting.type === "boolean") return raw === "true" || raw === "1";
  if (setting.type === "number") return Number(raw);
  try { return JSON.parse(raw); } catch { return raw; }
}

export default function AdminSettingsPage() {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const settingsQ = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: async () => {
      const result = await adminListSettings() as { items?: Setting[] };
      return result.items ?? [];
    },
  });
  const adminsQ = useQuery({
    queryKey: ["admin", "admins"],
    queryFn: () => adminListAdmins() as Promise<Admin[]>,
  });
  useEffect(() => {
    if (!settingsQ.data) return;
    setDrafts(Object.fromEntries(settingsQ.data.map((item) => [
      item.key,
      typeof item.value === "string" ? item.value : JSON.stringify(item.value),
    ])));
  }, [settingsQ.data]);
  const settingMut = useMutation({
    mutationFn: (setting: Setting) => adminUpdateSetting(setting.key, parseValue(setting, drafts[setting.key] ?? "")),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "settings"] }),
    onError: (e: Error) => setError(e.message),
  });
  const roleMut = useMutation({
    mutationFn: ({ id, role }: { id: string; role: "SUPER_ADMIN" | "OPS" }) => adminSetAdminRole(id, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "admins"] }),
    onError: (e: Error) => setError(e.message),
  });

  const adminColumns: Column<Admin>[] = [
    { key: "id", header: "ID", cell: (row) => String(row.id) },
    { key: "user", header: "管理员", cell: (row) => `${row.username || "—"} · ${row.email || "—"}` },
    { key: "role", header: "角色", cell: (row) => row.role || "—" },
    { key: "status", header: t("status"), cell: (row) => row.status || "—" },
    {
      key: "actions",
      header: t("actions"),
      cell: (row) => (
        <div className="flex gap-1">
          {(["SUPER_ADMIN", "OPS"] as const).map((role) => (
            <Button
              key={role}
              size="sm"
              variant={row.role === role ? "primary" : "secondary"}
              disabled={roleMut.isPending || row.role === role}
              onClick={() => roleMut.mutate({ id: String(row.id), role })}
            >
              {role}
            </Button>
          ))}
        </div>
      ),
    },
  ];

  return (
    <AdminShell title="系统设置">
      {error || settingsQ.error || adminsQ.error ? (
        <p className="mb-3 text-body-sm text-danger">{error || (settingsQ.error as Error)?.message || (adminsQ.error as Error)?.message}</p>
      ) : null}
      <div className="mb-10 space-y-3">
        {(settingsQ.data ?? []).map((item) => (
          <div key={item.key} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4">
            <div>
              <p className="text-body-sm font-medium">{item.labelZh || item.labelVi || item.key}</p>
              <p className="font-mono text-caption text-ink-muted">{item.key}</p>
              {item.updatedAt ? <p className="text-caption text-ink-muted">{fmtDate(item.updatedAt)}</p> : null}
            </div>
            <div className="flex items-center gap-2">
              {item.type === "boolean" ? (
                <Select className="w-28" value={drafts[item.key] ?? String(item.value)} onChange={(e) => setDrafts((d) => ({ ...d, [item.key]: e.target.value }))}>
                  <option value="true">启用</option><option value="false">停用</option>
                </Select>
              ) : (
                <Input className="w-52" value={drafts[item.key] ?? ""} onChange={(e) => setDrafts((d) => ({ ...d, [item.key]: e.target.value }))} />
              )}
              <Button size="sm" disabled={settingMut.isPending} onClick={() => settingMut.mutate(item)}>{t("save")}</Button>
            </div>
          </div>
        ))}
      </div>
      <h2 className="mb-3 text-h4">管理员角色</h2>
      <DataTable columns={adminColumns} rows={adminsQ.data ?? []} loading={adminsQ.isFetching} emptyTitle={t("empty")} />
    </AdminShell>
  );
}

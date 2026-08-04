"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminListAdmins, adminSetAdminRole, adminSetAdminStatus } from "@velvet/api-client";
import { Button, DataTable, type Column } from "@velvet/ui";
import { AdminShell } from "@/components/admin-shell";
import { useI18n, statusLabel } from "@/lib/i18n";
import { useMemo, useState } from "react";

type Admin = {
  id: string | number;
  username?: string;
  email?: string;
  role?: string;
  status?: string;
};

export default function AdminAdminsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const adminsQ = useQuery({
    queryKey: ["admin", "admins"],
    queryFn: async () => {
      const data = await adminListAdmins();
      const rows = Array.isArray(data) ? data : [];
      return rows.map((row: Admin) => ({
        ...row,
        id: typeof row.id === "bigint" ? String(row.id) : row.id,
      })) as Admin[];
    },
  });

  const roleMut = useMutation({
    mutationFn: ({ id, role }: { id: string; role: "SUPER_ADMIN" | "OPS" }) =>
      adminSetAdminRole(id, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "admins"] }),
    onError: (e: Error) => setError(e.message),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "ACTIVE" | "DISABLED" }) =>
      adminSetAdminStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "admins"] }),
    onError: (e: Error) => setError(e.message),
  });

  const adminColumns: Column<Admin>[] = useMemo(
    () => [
      { key: "id", header: t("colId"), cell: (row) => String(row.id) },
      {
        key: "user",
        header: t("colAdmin"),
        cell: (row) => `${row.username || "—"} · ${row.email || "—"}`,
      },
      { key: "role", header: t("colRole"), cell: (row) => row.role || "—" },
      { key: "status", header: t("status"), cell: (row) => statusLabel(t, row.status) },
      {
        key: "actions",
        header: t("actions"),
        cell: (row) => (
          <div className="flex flex-wrap gap-1">
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
            <Button
              size="sm"
              variant={row.status === "DISABLED" ? "secondary" : "danger"}
              disabled={statusMut.isPending}
              onClick={() =>
                statusMut.mutate({
                  id: String(row.id),
                  status: row.status === "DISABLED" ? "ACTIVE" : "DISABLED",
                })
              }
            >
              {row.status === "DISABLED" ? t("enable") : t("disable")}
            </Button>
          </div>
        ),
      },
    ],
    [t, roleMut, statusMut],
  );

  return (
    <AdminShell title={t("admins")}>
      {error || adminsQ.error ? (
        <p className="mb-3 text-body-sm text-danger">
          {error || (adminsQ.error as Error)?.message}
        </p>
      ) : null}
      <DataTable
        columns={adminColumns}
        rows={adminsQ.data ?? []}
        loading={adminsQ.isFetching}
        emptyTitle={t("empty")}
      />
    </AdminShell>
  );
}

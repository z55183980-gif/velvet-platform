"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminCreateAdmin,
  adminListAdmins,
  adminSetAdminRole,
  adminSetAdminStatus,
} from "@velvet/api-client";
import { Badge, Button, Input, Select, DataTable, fmtDate, type Column } from "@velvet/ui";
import { Plus } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { GlassModal } from "@/components/glass-modal";
import { useI18n, statusLabel } from "@/lib/i18n";

type Admin = {
  id: string | number;
  username?: string;
  email?: string;
  displayName?: string | null;
  role?: string;
  status?: string;
  createdAt?: string;
  lastLoginAt?: string | null;
};

function statusTone(status?: string): "success" | "warning" | "danger" | "default" {
  if (status === "ACTIVE") return "success";
  if (status === "DISABLED") return "danger";
  return "default";
}

function roleLabel(t: ReturnType<typeof useI18n>["t"], role?: string) {
  if (role === "OPS") return t("roleOps");
  if (role === "SUPER_ADMIN") return t("roleSuperAdmin");
  return role || "—";
}

function modalTitle(title: string, subtitle?: string) {
  return (
    <div>
      <div>{title}</div>
      {subtitle ? <p className="mt-0.5 text-caption font-normal text-ink-subtle">{subtitle}</p> : null}
    </div>
  );
}

function CreateAdminModal({
  onClose,
  t,
}: {
  onClose: () => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"SUPER_ADMIN" | "OPS">("OPS");
  const [error, setError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: () =>
      adminCreateAdmin({
        email: email.trim(),
        password,
        username: username.trim() || undefined,
        displayName: displayName.trim() || undefined,
        role,
      }),
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "admins"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const submit = () => {
    if (password.length < 8) {
      setError(t("passwordMin8"));
      return;
    }
    setError(null);
    createMut.mutate();
  };

  return (
    <GlassModal
      open
      onClose={() => {
        if (!createMut.isPending) onClose();
      }}
      title={modalTitle(t("createAdmin"), t("createAdminHint"))}
      size="md"
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!createMut.isPending) submit();
        }}
      >
        {error ? <p className="text-body-sm text-danger">{error}</p> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-caption font-medium text-ink-subtle sm:col-span-2">
            {t("fieldEmail")}
            <Input
              className="mt-1.5"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="block text-caption font-medium text-ink-subtle sm:col-span-2">
            {t("newPassword")}
            <Input
              className="mt-1.5"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </label>
          <label className="block text-caption font-medium text-ink-subtle">
            {t("loginAccount")}
            <span className="ml-1 font-normal text-ink-subtle/70">({t("optional")})</span>
            <Input
              className="mt-1.5"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t("adminUsernameHint")}
              maxLength={32}
            />
          </label>
          <label className="block text-caption font-medium text-ink-subtle">
            {t("fieldDisplayName")}
            <span className="ml-1 font-normal text-ink-subtle/70">({t("optional")})</span>
            <Input
              className="mt-1.5"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={64}
            />
          </label>
          <label className="block text-caption font-medium text-ink-subtle sm:col-span-2">
            {t("colRole")}
            <Select
              className="mt-1.5"
              value={role}
              onChange={(e) => setRole(e.target.value as "SUPER_ADMIN" | "OPS")}
            >
              <option value="OPS">{t("roleOps")}</option>
              <option value="SUPER_ADMIN">{t("roleSuperAdmin")}</option>
            </Select>
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={createMut.isPending}
            onClick={onClose}
          >
            {t("cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={createMut.isPending}>
            {createMut.isPending ? t("loading") : t("createAdmin")}
          </Button>
        </div>
      </form>
    </GlassModal>
  );
}

function ActionDivider() {
  return (
    <span className="text-ink-subtle/40" aria-hidden>
      |
    </span>
  );
}

function TextAction({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={[
        "rounded-lg px-2 py-1 text-body-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
        danger
          ? "text-danger hover:bg-danger/10"
          : "text-brand transition hover:bg-brand-soft",
      ].join(" ")}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default function AdminAdminsPage() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [applied, setApplied] = useState({ q: "", role: "ALL", status: "ALL" });
  const [createOpen, setCreateOpen] = useState(false);

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
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin", "admins"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "ACTIVE" | "DISABLED" }) =>
      adminSetAdminStatus(id, status),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin", "admins"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const applyFiltersNow = () => {
    setApplied({ q: q.trim(), role: roleFilter, status: statusFilter });
  };
  const setRoleFilterImmediate = (next: string) => {
    setRoleFilter(next);
    setApplied((prev) => ({ ...prev, role: next }));
  };
  const setStatusFilterImmediate = (next: string) => {
    setStatusFilter(next);
    setApplied((prev) => ({ ...prev, status: next }));
  };

  const filteredRows = useMemo(() => {
    const rows = adminsQ.data ?? [];
    const needle = applied.q.toLowerCase();
    return rows.filter((row) => {
      if (applied.role !== "ALL" && row.role !== applied.role) return false;
      if (applied.status !== "ALL" && row.status !== applied.status) return false;
      if (!needle) return true;
      const haystack = [row.email, row.username, row.displayName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [adminsQ.data, applied]);

  const adminColumns: Column<Admin>[] = useMemo(
    () => [
      {
        key: "id",
        header: t("colId"),
        cell: (row) => (
          <span className="font-mono text-caption tabular-nums text-ink-subtle">{String(row.id)}</span>
        ),
      },
      {
        key: "user",
        header: t("colAdmin"),
        cell: (row) => {
          const name = row.displayName || row.username || "—";
          const initial = name.charAt(0).toUpperCase();
          return (
            <div className="flex min-w-[12rem] max-w-[18rem] items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-soft text-caption font-semibold text-brand">
                {initial}
              </span>
              <div className="min-w-0">
                <div className="truncate text-body-sm font-medium text-ink">{name}</div>
                <div className="truncate text-caption text-ink-subtle">
                  {row.email || row.username || `ID ${row.id}`}
                </div>
              </div>
            </div>
          );
        },
      },
      {
        key: "role",
        header: t("colRole"),
        cell: (row) => (
          <Badge tone={row.role === "SUPER_ADMIN" ? "warning" : "default"}>
            {roleLabel(t, row.role)}
          </Badge>
        ),
      },
      {
        key: "status",
        header: t("status"),
        cell: (row) => <Badge tone={statusTone(row.status)}>{statusLabel(t, row.status)}</Badge>,
      },
      {
        key: "created",
        header: t("colCreated"),
        cell: (row) => (
          <span className="whitespace-nowrap text-caption text-ink-muted">
            {row.createdAt ? fmtDate(row.createdAt, locale === "en" ? "en-US" : "zh-CN") : "—"}
          </span>
        ),
      },
      {
        key: "actions",
        header: t("actions"),
        cell: (row) => {
          const busy = roleMut.isPending || statusMut.isPending;
          const nextRole = row.role === "SUPER_ADMIN" ? "OPS" : "SUPER_ADMIN";
          const disabled = row.status === "DISABLED";
          return (
            <div className="flex items-center gap-1">
              <TextAction
                disabled={busy || row.role === nextRole}
                onClick={() =>
                  roleMut.mutate({
                    id: String(row.id),
                    role: nextRole,
                  })
                }
              >
                {nextRole === "SUPER_ADMIN" ? t("setRoleSuperAdmin") : t("setRoleOps")}
              </TextAction>
              <ActionDivider />
              <TextAction
                danger={!disabled}
                disabled={busy}
                onClick={() =>
                  statusMut.mutate({
                    id: String(row.id),
                    status: disabled ? "ACTIVE" : "DISABLED",
                  })
                }
              >
                {disabled ? t("enable") : t("disable")}
              </TextAction>
            </div>
          );
        },
      },
    ],
    [t, locale, roleMut, statusMut],
  );

  return (
    <AdminShell title={t("admins")}>
      {error || adminsQ.error ? (
        <p className="mb-3 text-body-sm text-danger">
          {error || (adminsQ.error as Error)?.message}
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <Button
          size="sm"
          className="cursor-pointer hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.97]"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-4 w-4" />
          {t("createAdmin")}
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white/45 p-3">
        <Input
          className="w-full sm:w-64"
          placeholder={t("adminSearchPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") applyFiltersNow();
          }}
        />
        <Select
          className="w-36"
          value={roleFilter}
          onChange={(e) => setRoleFilterImmediate(e.target.value)}
        >
          <option value="ALL">{t("roleAll")}</option>
          <option value="SUPER_ADMIN">{t("roleSuperAdmin")}</option>
          <option value="OPS">{t("roleOps")}</option>
        </Select>
        <Select
          className="w-32"
          value={statusFilter}
          onChange={(e) => setStatusFilterImmediate(e.target.value)}
        >
          <option value="ALL">{t("statusAll")}</option>
          <option value="ACTIVE">{statusLabel(t, "ACTIVE")}</option>
          <option value="DISABLED">{statusLabel(t, "DISABLED")}</option>
        </Select>
        <Button size="sm" onClick={applyFiltersNow}>
          {t("query")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => adminsQ.refetch()}
          disabled={adminsQ.isFetching}
        >
          {t("refresh")}
        </Button>
      </div>

      <DataTable
        className="admins-table"
        columns={adminColumns}
        rows={filteredRows}
        loading={adminsQ.isFetching}
        emptyTitle={t("empty")}
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white/45 px-3 py-2 text-caption text-ink-muted">
        <span className="font-medium text-ink-subtle">
          {t("totalCount", { n: filteredRows.length })}
        </span>
      </div>

      {createOpen ? <CreateAdminModal onClose={() => setCreateOpen(false)} t={t} /> : null}
    </AdminShell>
  );
}

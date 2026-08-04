"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { adminBroadcastNotification } from "@velvet/api-client";
import { Button, Input } from "@velvet/ui";
import { AdminShell } from "@/components/admin-shell";
import { useI18n } from "@/lib/i18n";

export default function AdminMessagesPage() {
  const { t } = useI18n();
  const [form, setForm] = useState({
    userId: "",
    titleZh: "",
    bodyZh: "",
    broadcast: false,
  });
  const [result, setResult] = useState<{ created?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sendMut = useMutation({
    mutationFn: () => {
      const titleZh = form.titleZh.trim();
      const bodyZh = form.bodyZh.trim();
      return adminBroadcastNotification({
        titleZh,
        titleVi: titleZh,
        bodyZh,
        bodyVi: bodyZh,
        userId: form.broadcast ? undefined : form.userId.trim() || undefined,
        broadcast: form.broadcast,
      }) as Promise<{ created?: number }>;
    },
    onSuccess: (data) => {
      setResult(data);
      setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <AdminShell title={t("messages")}>
      {error ? <p className="mb-3 text-body-sm text-danger">{error}</p> : null}

      <div className="mb-6 max-w-2xl space-y-3 card glass-card p-4">
        <p className="text-body-sm text-ink-muted">{t("broadcastHint")}</p>
        <label className="flex items-center gap-2 text-caption text-ink-muted">
          <input
            type="checkbox"
            checked={form.broadcast}
            onChange={(e) => setForm((f) => ({ ...f, broadcast: e.target.checked }))}
          />
          {t("broadcastAll")}
        </label>
        {!form.broadcast ? (
          <label className="block text-caption text-ink-muted">
            {t("userIdLabel")}
            <Input
              className="mt-1"
              value={form.userId}
              onChange={(e) => setForm((f) => ({ ...f, userId: e.target.value }))}
              placeholder={t("userIdPlaceholder")}
            />
          </label>
        ) : null}
        <label className="block text-caption text-ink-muted">
          {t("titleZhLabel")}
          <Input
            className="mt-1"
            value={form.titleZh}
            onChange={(e) => setForm((f) => ({ ...f, titleZh: e.target.value }))}
          />
        </label>
        <label className="block text-caption text-ink-muted">
          {t("bodyZhLabel")}
          <Input
            className="mt-1"
            value={form.bodyZh}
            onChange={(e) => setForm((f) => ({ ...f, bodyZh: e.target.value }))}
          />
        </label>
        <Button
          size="sm"
          disabled={sendMut.isPending || !form.titleZh.trim() || !form.bodyZh.trim()}
          onClick={() => {
            if (form.broadcast && !window.confirm(t("confirmBroadcast"))) return;
            sendMut.mutate();
          }}
        >
          {sendMut.isPending ? t("sending") : t("sendMessage")}
        </Button>
      </div>

      {result ? (
        <p className="text-body-sm text-ink-muted">{t("createdNotifications", { n: result.created ?? 0 })}</p>
      ) : null}
    </AdminShell>
  );
}

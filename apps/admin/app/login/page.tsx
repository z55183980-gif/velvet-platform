"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { buttonVariants, Input } from "@velvet/ui";
import { adminLogin, adminMe, getAdminToken } from "@velvet/api-client";

const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000";

export default function AdminLoginPage() {
  const router = useRouter();
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const token = getAdminToken();
    if (!token || !token.includes(".")) return;
    adminMe()
      .then(() => router.replace("/dashboard"))
      .catch(() => undefined);
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await adminLogin(account.trim(), password);
      router.replace("/dashboard");
    } catch {
      setErr("账号或密码错误");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-[960px] flex-col justify-center px-4 py-10 md:px-6">
      <div className="mx-auto w-full max-w-md">
        <p className="text-overline uppercase text-ink-subtle">Ops</p>
        <div className="mt-2 flex items-end justify-between gap-4">
          <h1 className="text-h2 font-bold text-ink">控制台登录</h1>
          <a href={WEB_URL} className="text-body-sm text-ink-muted hover:text-ink">
            ← 回前台
          </a>
        </div>

        <form onSubmit={onSubmit} className="mt-8 rounded-xl bg-surface-2 p-6" autoComplete="on">
          <label className="text-caption text-ink-subtle">账号</label>
          <Input
            className="mt-2"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            autoComplete="username"
            required
          />

          <label className="mt-4 block text-caption text-ink-subtle">密码</label>
          <Input
            type="password"
            className="mt-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />

          <button
            type="submit"
            disabled={busy}
            className={buttonVariants({ variant: "primary" }) + " mt-5 w-full"}
          >
            {busy ? "登录中…" : "登录"}
          </button>

          {err ? <p className="mt-3 text-caption text-danger">{err}</p> : null}
        </form>
      </div>
    </div>
  );
}

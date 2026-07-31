"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n";
import { buttonVariants } from "@/components/ui/button";
import { adminLogin, adminMe, getAdminToken } from "@/lib/api";
import { adminPath } from "@/lib/admin-path";

export default function AdminLoginPage() {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const router = useRouter();
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const token = getAdminToken();
    if (!token || !token.includes(".")) return;
    adminMe()
      .then(() => router.replace(adminPath("/dashboard")))
      .catch(() => undefined);
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await adminLogin(account.trim(), password);
      router.replace(adminPath("/dashboard"));
    } catch {
      // 统一文案，不暴露「邮箱/用户名/密码」哪一项错了，也不展示服务端细节
      setErr(zh ? "账号或密码错误" : "Thông tin đăng nhập không đúng");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-[960px] flex-col justify-center px-4 py-10 md:px-6">
      <div className="mx-auto w-full max-w-md">
        <p className="text-overline uppercase text-ink-subtle">Ops</p>
        <div className="mt-2 flex items-end justify-between gap-4">
          <h1 className="text-h2 font-bold text-ink">{zh ? "控制台登录" : "Đăng nhập"}</h1>
          <Link href="/" className="text-body-sm text-ink-muted hover:text-ink">
            ← {zh ? "回首页" : "Về trang chủ"}
          </Link>
        </div>

        <form onSubmit={onSubmit} className="mt-8 rounded-xl bg-surface-2 p-6" autoComplete="on">
          <label className="text-caption text-ink-subtle">
            {zh ? "账号" : "Tài khoản"}
          </label>
          <input
            className="mt-2 w-full rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            autoComplete="username"
            required
          />

          <label className="mt-4 block text-caption text-ink-subtle">
            {zh ? "密码" : "Mật khẩu"}
          </label>
          <input
            type="password"
            className="mt-2 w-full rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink"
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
            {busy ? (zh ? "登录中…" : "Đang đăng nhập…") : zh ? "登录" : "Đăng nhập"}
          </button>

          {err && <p className="mt-3 text-caption text-red-400">{err}</p>}
        </form>
      </div>
    </div>
  );
}

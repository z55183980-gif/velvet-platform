"use client";

import Link from "next/link";
import { useLocale } from "@/lib/i18n";

export default function NotFound() {
  const { t, locale } = useLocale();
  const zh = locale === "zh";

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-[640px] flex-col items-center justify-center px-4 py-20 text-center">
      <p className="text-overline uppercase tracking-widest text-brand">404</p>
      <h1 className="mt-3 text-h2 font-bold text-ink">
        {zh ? "页面不存在" : "Không tìm thấy trang"}
      </h1>
      <p className="mt-3 text-body text-ink-muted">
        {zh
          ? "链接可能已失效，或页面尚未上线。"
          : "Liên kết có thể đã hết hạn hoặc trang chưa tồn tại."}
      </p>
      <Link
        href="/"
        className="mt-8 rounded-full bg-brand px-6 py-3 text-body-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        {t("nav.home")}
      </Link>
    </div>
  );
}

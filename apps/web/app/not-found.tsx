"use client";

import Link from "next/link";

/** Static 404 — never depends on LocaleProvider (Next may render outside client tree). */
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-[640px] flex-col items-center justify-center px-4 py-20 text-center">
      <p className="text-overline uppercase tracking-widest text-brand">404</p>
      <h1 className="mt-3 text-h2 font-bold text-ink">Page not found</h1>
      <p className="mt-3 text-body text-ink-muted">
        The link may have expired, or this page is not available yet.
      </p>
      <Link
        href="/"
        className="mt-8 rounded-full bg-brand px-6 py-3 text-body-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        Home
      </Link>
    </div>
  );
}

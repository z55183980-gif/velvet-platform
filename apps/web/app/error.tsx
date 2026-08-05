"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Route error boundary — keep static (no useLocale) so recovery UI always mounts.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-[640px] flex-col items-center justify-center px-4 py-20 text-center">
      <p className="text-overline uppercase tracking-widest text-brand">Error</p>
      <h1 className="mt-3 text-h2 font-bold text-ink">This page couldn’t load</h1>
      <p className="mt-3 text-body text-ink-muted">
        Something went wrong. Try again, or go back home.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-full bg-brand px-6 py-3 text-body-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-full border border-line bg-surface px-6 py-3 text-body-sm font-medium text-ink transition-colors hover:bg-surface-2"
        >
          Home
        </Link>
      </div>
    </div>
  );
}

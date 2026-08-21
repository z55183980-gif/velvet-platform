"use client";

import { useEffect } from "react";

export function RedirectToPlayback({ href }: { href: string }) {
  useEffect(() => {
    window.location.replace(href);
  }, [href]);

  return (
    <main className="flex min-h-[70vh] items-center justify-center bg-black px-6 text-white">
      <a
        href={href}
        className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-black"
      >
        ▶ 播放
      </a>
    </main>
  );
}

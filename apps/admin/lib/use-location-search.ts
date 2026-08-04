"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

const URL_EVENT = "velvet:urlchange";

/** 异步通知，避免在 React useInsertionEffect 期间同步 setState */
function emitUrlChange() {
  queueMicrotask(() => {
    window.dispatchEvent(new Event(URL_EVENT));
  });
}

function ensureHistoryEventsPatched() {
  if (typeof window === "undefined") return;
  const w = window as Window & { __velvetHistoryPatched?: boolean };
  if (w.__velvetHistoryPatched) return;
  w.__velvetHistoryPatched = true;

  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);

  history.pushState = ((...args: Parameters<History["pushState"]>) => {
    const ret = origPush(...args);
    emitUrlChange();
    return ret;
  }) as History["pushState"];

  history.replaceState = ((...args: Parameters<History["replaceState"]>) => {
    const ret = origReplace(...args);
    emitUrlChange();
    return ret;
  }) as History["replaceState"];
}

function readSearch() {
  if (typeof window === "undefined") return "";
  return window.location.search;
}

/**
 * 读取当前 URL query，不使用 Next.js useSearchParams（避免 Suspense 整页回退）。
 * history 变更通过异步事件通知，避免 useInsertionEffect must not schedule updates。
 */
export function useLocationSearchParams() {
  const pathname = usePathname();
  const [search, setSearch] = useState(readSearch);

  useEffect(() => {
    ensureHistoryEventsPatched();
    const sync = () => setSearch(readSearch());
    sync();
    window.addEventListener("popstate", sync);
    window.addEventListener(URL_EVENT, sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(URL_EVENT, sync);
    };
  }, [pathname]);

  return useMemo(
    () => new URLSearchParams(search.startsWith("?") ? search.slice(1) : search),
    [search],
  );
}

"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

type HistoryMethod = typeof window.history.pushState;

function resolveUrl(url: string | URL | null | undefined): URL | null {
  if (url == null || url === "") return null;
  try {
    return typeof url === "string" ? new URL(url, window.location.href) : new URL(url.href);
  } catch {
    return null;
  }
}

function isContentAddPath(pathname: string): boolean {
  return pathname === "/content/add" || pathname.endsWith("/content/add");
}

/**
 * Block SPA navigations away from the page when dirty.
 * Same-path query updates (e.g. ?tab=) are allowed — callers should confirm those separately.
 * Refresh / tab close uses the browser native beforeunload dialog.
 */
export function useUnsavedNavigationGuard(options: {
  enabled: boolean;
  /** Synchronous dirty flag — must update before intentional navigations. */
  dirtyRef: MutableRefObject<boolean>;
}) {
  const { enabled, dirtyRef } = options;
  const bypassRef = useRef(false);
  const reversingPopRef = useRef(false);
  const pendingRef = useRef<(() => void) | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const requestLeave = useCallback((action: () => void) => {
    if (bypassRef.current || !dirtyRef.current) {
      action();
      return;
    }
    pendingRef.current = action;
    setConfirmOpen(true);
  }, [dirtyRef]);

  const confirmLeave = useCallback(() => {
    const action = pendingRef.current;
    pendingRef.current = null;
    setConfirmOpen(false);
    dirtyRef.current = false;
    bypassRef.current = true;
    try {
      action?.();
    } finally {
      queueMicrotask(() => {
        bypassRef.current = false;
      });
    }
  }, [dirtyRef]);

  const cancelLeave = useCallback(() => {
    pendingRef.current = null;
    setConfirmOpen(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current || bypassRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirtyRef, enabled]);

  useEffect(() => {
    if (!enabled) return;

    const origPush: HistoryMethod = window.history.pushState.bind(window.history);
    const origReplace: HistoryMethod = window.history.replaceState.bind(window.history);

    const shouldBlock = (url: string | URL | null | undefined) => {
      if (bypassRef.current || !dirtyRef.current) return false;
      const next = resolveUrl(url);
      if (!next) return false;
      // Stay on add page (tab query, etc.) — ContentAddPanel confirms tab switches itself.
      if (isContentAddPath(next.pathname) && isContentAddPath(window.location.pathname)) {
        return false;
      }
      return (
        next.pathname !== window.location.pathname || next.search !== window.location.search
      );
    };

    window.history.pushState = (data, unused, url) => {
      if (!shouldBlock(url)) return origPush(data, unused, url);
      requestLeave(() => origPush(data, unused, url));
    };

    window.history.replaceState = (data, unused, url) => {
      if (!shouldBlock(url)) return origReplace(data, unused, url);
      requestLeave(() => origReplace(data, unused, url));
    };

    return () => {
      window.history.pushState = origPush;
      window.history.replaceState = origReplace;
    };
  }, [dirtyRef, enabled, requestLeave]);

  useEffect(() => {
    if (!enabled) return;

    const onPopState = () => {
      if (reversingPopRef.current) {
        reversingPopRef.current = false;
        return;
      }
      if (bypassRef.current || !dirtyRef.current) return;
      reversingPopRef.current = true;
      window.history.go(1);
      requestLeave(() => {
        bypassRef.current = true;
        window.history.go(-1);
        queueMicrotask(() => {
          bypassRef.current = false;
        });
      });
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [dirtyRef, enabled, requestLeave]);

  return {
    confirmOpen,
    confirmLeave,
    cancelLeave,
    requestLeave,
  };
}

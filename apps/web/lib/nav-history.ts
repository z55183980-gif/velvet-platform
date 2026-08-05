"use client";

/**
 * `window.history.length` counts the whole tab's session history, including
 * pages from other sites — so it cannot answer "is there an in-app page to go
 * back to". Pasting a shared /drama/... link into a tab that already browsed
 * elsewhere makes it >1, and router.back() then leaves the site.
 *
 * Two signals instead:
 * - a client-side navigation happened in this app instance (AppShell marks it), or
 * - this document was loaded from a same-origin page (full reload within the site).
 */
let inAppNavigations = 0;

export function markInAppNavigation() {
  inAppNavigations += 1;
}

/** True only when back() is known to land on a page of this site. */
export function canGoBackInApp(): boolean {
  if (typeof window === "undefined") return false;
  if (window.history.length <= 1) return false;
  if (inAppNavigations > 0) return true;
  const referrer = document.referrer;
  if (!referrer) return false;
  try {
    return new URL(referrer).origin === window.location.origin;
  } catch {
    return false;
  }
}

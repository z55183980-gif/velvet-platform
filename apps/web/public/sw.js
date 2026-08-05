/* PWA installability SW — must not own navigations.
 *
 * Intercepting every fetch with respondWith(fetch()) turns transient network /
 * origin blips into a hard browser interstitial ("This page couldn't load").
 * Leave navigations to the browser; keep a no-op-ish handler for Chromium install checks.
 */
const SW_VERSION = "velvet-sw-2026-08-05-2";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        await self.clients.claim();
      } catch {
        /* ignore */
      }
      // Bust any older caches from previous SW experiments.
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.mode === "navigate") {
    // Critical: do not wrap navigations. Browser recovery stays intact.
    return;
  }
  // Same-origin asset/API: network only, never cache HTML shell.
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request).catch(() => Response.error()),
  );
});

// Touch version so update() detects the new worker.
void SW_VERSION;

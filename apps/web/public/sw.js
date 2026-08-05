/* PWA installability SW — must not own requests.
 *
 * Chromium installability only requires a fetch listener to exist; calling
 * respondWith(fetch()) for every same-origin asset/API (including Range video
 * segments) is pure passthrough with Safari Range pitfalls and no benefit.
 * Leave all requests to the browser; keep this no-op handler for install checks.
 */
const SW_VERSION = "velvet-sw-2026-08-05-3";

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

self.addEventListener("fetch", () => {
  // Intentionally empty: presence of the listener satisfies Chromium PWA checks.
  // Do not respondWith — navigations, Range media, and APIs stay with the browser.
});

// Touch version so update() detects the new worker.
void SW_VERSION;

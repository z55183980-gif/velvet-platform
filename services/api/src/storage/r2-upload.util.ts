export function normalizeR2HlsUploadConcurrency(value: unknown, fallback = 4) {
  const parsed = Number(value);
  const safeFallback = Number.isFinite(fallback) ? Math.floor(fallback) : 4;
  const concurrency = Number.isFinite(parsed) ? Math.floor(parsed) : safeFallback;
  return Math.min(8, Math.max(1, concurrency));
}

/** Run all in-flight work to settlement, but stop scheduling after the first error. */
export async function forEachBounded<T>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
) {
  let cursor = 0;
  let firstError: unknown;
  const workerCount = Math.min(Math.max(1, Math.floor(concurrency)), items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (firstError == null) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        await task(items[index]);
      } catch (error) {
        firstError ??= error;
      }
    }
  });
  await Promise.all(workers);
  if (firstError != null) throw firstError;
}

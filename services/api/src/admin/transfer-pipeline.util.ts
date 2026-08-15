export function normalizeTransferPipelineDepth(value: unknown, fallback = 2) {
  const parsed = Number(value);
  const safeFallback = Number.isFinite(fallback) ? Math.floor(fallback) : 2;
  const depth = Number.isFinite(parsed) ? Math.floor(parsed) : safeFallback;
  return Math.min(4, Math.max(1, depth));
}

/** Keep source pressure modest while allowing one additional drama to prefetch. */
export function normalizeTransferJobConcurrency(value: unknown, fallback = 1) {
  const parsed = Number(value);
  const safeFallback = Number.isFinite(fallback) ? Math.floor(fallback) : 1;
  const concurrency = Number.isFinite(parsed) ? Math.floor(parsed) : safeFallback;
  return Math.min(2, Math.max(1, concurrency));
}

/** Backward-compatible default: jobs created before this flag existed publish on success. */
export function shouldAutoPublishTransfer(value: unknown) {
  return value !== false;
}

/**
 * Keeps a small ordered window of transferred episodes. Pushing the Nth entry
 * settles the oldest one, allowing the next download to overlap the previous
 * transcode without unboundedly filling local disk or the worker queue.
 */
export class BoundedTransferPipeline<T, TResult> {
  private readonly pending: T[] = [];

  constructor(
    readonly depth: number,
    private readonly settle: (entry: T) => Promise<TResult>,
  ) {}

  get pendingCount() {
    return this.pending.length;
  }

  async push(entry: T): Promise<TResult | null> {
    this.pending.push(entry);
    if (this.pending.length < this.depth) return null;
    return this.settle(this.pending.shift()!);
  }

  async drain(): Promise<TResult[]> {
    const results: TResult[] = [];
    while (this.pending.length) {
      results.push(await this.settle(this.pending.shift()!));
    }
    return results;
  }
}

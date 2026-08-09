/** Shared lock-mode helpers for create + edit drama playback policy UI. */

export type DramaLockModeValue = "FREE_FIRST_N" | "VIP_ALL" | "ALL_FREE";

export type GlobalLockMode = DramaLockModeValue;

export function parseLockMode(v: unknown): GlobalLockMode {
  if (v === "ALL_FREE" || v === "VIP_ALL" || v === "FREE_FIRST_N") return v;
  return "FREE_FIRST_N";
}

/** Preview free-count under Follow Global (runtime freeCount comes from global). */
export function freeCountWhenInheriting(opts: {
  total: number;
  globalMode: GlobalLockMode;
  globalFreeCount: number;
}): number {
  if (!opts.total) return 0;
  if (opts.globalMode === "ALL_FREE") return opts.total;
  if (opts.globalMode === "VIP_ALL") return 0;
  return Math.min(opts.total, Math.max(0, opts.globalFreeCount));
}

/** Denormalized freeEpisodeCount stamp when lockMode is null — always global free count. */
export function stampFreeCountWhenInheriting(globalFreeCount: number): number {
  return Math.max(0, Math.floor(Number(globalFreeCount) || 0));
}

export function freeThruWhenInheriting(opts: {
  total: number;
  globalMode: GlobalLockMode;
  globalFreeCount: number;
}): number {
  if (opts.globalMode === "ALL_FREE") return opts.total;
  if (opts.globalMode === "VIP_ALL") return 0;
  return Math.min(opts.total, Math.max(0, opts.globalFreeCount));
}

/** Custom (non-inherit) range → lock mode + freeThru. Empty range = ALL_FREE. */
export function resolveCustomFreePolicy(
  total: number,
  freeRangeStart: string,
  freeRangeEnd: string,
): {
  freeThru: number;
  freeCount: number;
  lockMode: DramaLockModeValue;
} {
  if (!freeRangeStart && !freeRangeEnd) {
    return { freeThru: total, freeCount: total, lockMode: "ALL_FREE" };
  }
  const freeStart = Number(freeRangeStart);
  const freeEnd = Number(freeRangeEnd);
  if (
    !Number.isInteger(freeStart) ||
    !Number.isInteger(freeEnd) ||
    freeStart < 1 ||
    freeEnd < freeStart
  ) {
    throw new Error("INVALID_RANGE");
  }
  if (total > 0 && freeStart > total) {
    return { freeThru: 0, freeCount: 0, lockMode: "VIP_ALL" };
  }
  if (total > 0 && freeEnd > total) {
    throw new Error("INVALID_RANGE");
  }
  const freeThru = Math.max(0, Math.min(total, freeEnd));
  const lockMode: DramaLockModeValue =
    total > 0 && freeThru >= total ? "ALL_FREE" : freeThru <= 0 ? "VIP_ALL" : "FREE_FIRST_N";
  return {
    freeThru,
    freeCount: lockMode === "ALL_FREE" ? total : lockMode === "VIP_ALL" ? 0 : freeThru,
    lockMode,
  };
}

export function freeEpisodeCountFromCustomPolicy(
  total: number,
  freeRangeStart: string,
  freeRangeEnd: string,
): number {
  if (!total) return 0;
  try {
    return resolveCustomFreePolicy(total, freeRangeStart, freeRangeEnd).freeCount;
  } catch {
    return total;
  }
}

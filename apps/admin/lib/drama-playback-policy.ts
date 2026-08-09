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

/**
 * Custom (non-inherit) free policy.
 * `allFree` maps to real ALL_FREE lock mode (future episodes stay free).
 * Do NOT infer ALL_FREE from freeEnd >= total — that would leave later appends paid.
 */
export function resolveCustomFreePolicy(
  total: number,
  freeRangeStart: string,
  freeRangeEnd: string,
  allFree = false,
): {
  freeThru: number;
  freeCount: number;
  lockMode: DramaLockModeValue;
} {
  if (allFree) {
    return {
      freeThru: Number.POSITIVE_INFINITY,
      freeCount: 0,
      lockMode: "ALL_FREE",
    };
  }
  const freeStart = Number(freeRangeStart);
  const freeEnd = Number(freeRangeEnd);
  if (
    !Number.isInteger(freeStart) ||
    !Number.isInteger(freeEnd) ||
    freeStart < 1 ||
    freeEnd < 0
  ) {
    throw new Error("INVALID_RANGE");
  }
  // end 0 = no free episodes (VIP_ALL); mirrors global settings.
  if (freeEnd === 0) {
    return { freeThru: 0, freeCount: 0, lockMode: "VIP_ALL" };
  }
  if (freeEnd < freeStart) {
    throw new Error("INVALID_RANGE");
  }
  // Runtime FREE_FIRST_N only supports first-N (episodes 1..N). Mid-range
  // free (e.g. 5–10) would incorrectly free 1–10 if we stamped freeCount=end.
  if (freeStart !== 1) {
    throw new Error("START_MUST_BE_ONE");
  }
  if (total > 0 && freeStart > total) {
    return { freeThru: 0, freeCount: 0, lockMode: "VIP_ALL" };
  }
  if (total > 0 && freeEnd > total) {
    throw new Error("INVALID_RANGE");
  }
  const freeThru = Math.max(0, freeEnd);
  return {
    freeThru,
    freeCount: freeThru,
    lockMode: freeThru <= 0 ? "VIP_ALL" : "FREE_FIRST_N",
  };
}

export function freeEpisodeCountFromCustomPolicy(
  total: number,
  freeRangeStart: string,
  freeRangeEnd: string,
  allFree = false,
): number {
  if (!total) return 0;
  if (allFree) return total;
  try {
    return resolveCustomFreePolicy(total, freeRangeStart, freeRangeEnd, false).freeCount;
  } catch {
    return 0;
  }
}

/**
 * Global settings free policy (no drama total).
 * `allFree` → episodeLockMode=ALL_FREE (future episodes stay free).
 * freeEnd === 0 → VIP_ALL (all episodes paid; create encodes this via start > total).
 * Otherwise FREE_FIRST_N with freeCount = end (first-N only; start must be 1).
 */
export function resolveGlobalFreeRangePolicy(
  allFree: boolean,
  freeRangeStart: string,
  freeRangeEnd: string,
): {
  freeCount: number;
  lockMode: DramaLockModeValue;
} {
  if (allFree) {
    return { freeCount: 0, lockMode: "ALL_FREE" };
  }
  const freeStart = Number(freeRangeStart);
  const freeEnd = Number(freeRangeEnd);
  if (!Number.isInteger(freeStart) || !Number.isInteger(freeEnd) || freeStart < 1) {
    throw new Error("INVALID_RANGE");
  }
  if (freeEnd === 0) {
    return { freeCount: 0, lockMode: "VIP_ALL" };
  }
  if (freeEnd < freeStart) {
    throw new Error("INVALID_RANGE");
  }
  if (freeStart !== 1) {
    throw new Error("START_MUST_BE_ONE");
  }
  return { freeCount: freeEnd, lockMode: "FREE_FIRST_N" };
}

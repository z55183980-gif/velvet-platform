"use client";

import { useCallback } from "react";

/**
 * Guest free-preview policy.
 * Stable callbacks are required — unstable identities re-trigger play/HLS effects.
 */
export function useGuestWatchQuota() {
  // Free/unlocked episodes may stream for guests (API already allows anonymous play).
  const canWatch = useCallback((_episodeId: string) => true, []);
  const markWatched = useCallback((_episodeId: string) => {}, []);

  return {
    ready: true as const,
    limit: Number.POSITIVE_INFINITY,
    canWatch,
    markWatched,
  };
}

import type { Episode } from "@/lib/mock-data";

/**
 * Member/VIP pricing badge — derived from content lock policy (`isFree`),
 * not from whether the current user can already play the episode.
 */
export function episodeRequiresMembership(ep: Pick<Episode, "isFree">): boolean {
  return !ep.isFree;
}

/**
 * Guest (logged-out) must sign in before member-priced playback / unlock UI.
 * When previewSeconds > 0, allow guest trial first; login/paywall runs after preview ends.
 */
export function guestNeedsLoginForEpisode(
  ep: Pick<Episode, "isFree" | "previewSeconds">,
  opts: { user: unknown; isUnlocked: boolean },
): boolean {
  if (opts.user || opts.isUnlocked || !episodeRequiresMembership(ep)) return false;
  if ((ep.previewSeconds || 0) > 0) return false;
  return true;
}

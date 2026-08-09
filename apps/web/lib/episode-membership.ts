import type { Episode } from "@/lib/mock-data";

/**
 * Member/VIP pricing badge — derived from content lock policy (`isFree`),
 * not from whether the current user can already play the episode.
 */
export function episodeRequiresMembership(ep: Pick<Episode, "isFree">): boolean {
  return !ep.isFree;
}

/** Guest (logged-out) must sign in before member-priced playback / unlock UI. */
export function guestNeedsLoginForEpisode(
  ep: Pick<Episode, "isFree">,
  opts: { user: unknown; isUnlocked: boolean },
): boolean {
  return !opts.user && !opts.isUnlocked && episodeRequiresMembership(ep);
}

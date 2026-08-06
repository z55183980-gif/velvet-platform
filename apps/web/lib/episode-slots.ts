import type { Episode } from "@/lib/mock-data";

export type EpisodeSlot =
  | { kind: "episode"; no: number; episode: Episode }
  | { kind: "placeholder"; no: number };

/** Build 1..total slots, filling missing numbers as serialization placeholders. */
export function buildEpisodeSlots(episodes: Episode[], total: number): EpisodeSlot[] {
  const byNo = new Map(episodes.map((ep) => [ep.no, ep]));
  const maxNo = episodes.reduce((m, ep) => Math.max(m, ep.no), 0);
  const count = Math.max(0, Math.floor(total) || 0, maxNo);
  return Array.from({ length: count }, (_, i) => {
    const no = i + 1;
    const episode = byNo.get(no);
    return episode
      ? ({ kind: "episode", no, episode } as const)
      : ({ kind: "placeholder", no } as const);
  });
}

export function filterSlotsByRange(slots: EpisodeSlot[], start: number, end: number) {
  return slots.filter((slot) => slot.no >= start && slot.no <= end);
}

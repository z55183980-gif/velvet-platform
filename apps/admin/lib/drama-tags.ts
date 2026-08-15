/** Admin helpers for Drama.tags (display labels + type:/completion: conventions). */

export type DramaContentType = "漫剧" | "真人短剧" | "AI短剧";
export type DramaCompletion = "连载中" | "已完结";

export const CONTENT_TYPE_VALUES: DramaContentType[] = ["漫剧", "真人短剧", "AI短剧"];
export const COMPLETION_VALUES: DramaCompletion[] = ["连载中", "已完结"];
export const DEFAULT_CONTENT_TYPE: DramaContentType = "真人短剧";
export const DEFAULT_COMPLETION: DramaCompletion = "连载中";
export const MAX_DRAMA_TAGS = 6;

const META_TAG_SKIP = new Set([
  "upload",
  "r2",
  "transfer",
  "telegram",
  "episode-list",
]);

const CONTENT_TYPE_ALIASES: Record<string, DramaContentType> = {
  漫剧: "漫剧",
  comic: "漫剧",
  manga: "漫剧",
  真人短剧: "真人短剧",
  真人: "真人短剧",
  live: "真人短剧",
  "live-action": "真人短剧",
  AI短剧: "AI短剧",
  AI剧: "AI短剧",
  ai: "AI短剧",
};

export function normalizeContentType(value: string | undefined): DramaContentType {
  const key = String(value || "").trim();
  if (!key) return DEFAULT_CONTENT_TYPE;
  return CONTENT_TYPE_ALIASES[key] || CONTENT_TYPE_ALIASES[key.toLowerCase()] || DEFAULT_CONTENT_TYPE;
}

export function normalizeCompletion(value: string | undefined): DramaCompletion {
  const key = String(value || "").trim();
  if (key === "已完结" || key.toLowerCase() === "finished" || key.toLowerCase() === "completed") {
    return "已完结";
  }
  return "连载中";
}

export function parseDramaTags(tags: string[] | undefined) {
  let contentType = DEFAULT_CONTENT_TYPE;
  let completion = DEFAULT_COMPLETION;
  const displayTags: string[] = [];
  for (const raw of tags ?? []) {
    const tag = String(raw || "").trim();
    if (!tag) continue;
    if (tag.startsWith("type:")) {
      contentType = normalizeContentType(tag.slice(5));
      continue;
    }
    if (tag.startsWith("completion:")) {
      completion = normalizeCompletion(tag.slice("completion:".length));
      continue;
    }
    if (
      META_TAG_SKIP.has(tag.toLowerCase()) ||
      tag.toLowerCase().startsWith("ytdlp") ||
      tag.toLowerCase().startsWith("source:") ||
      tag.toLowerCase().startsWith("tg:") ||
      tag.toLowerCase().startsWith("seg:")
    ) continue;
    displayTags.push(tag);
  }
  return { contentType, completion, displayTags };
}

export function composeDramaSourceTags(
  tags: string[],
  contentType: DramaContentType | string,
  completion: DramaCompletion | string,
): string[] {
  const display = tags.map((t) => String(t).trim()).filter(Boolean).slice(0, MAX_DRAMA_TAGS);
  return [
    ...display,
    `type:${normalizeContentType(String(contentType))}`,
    `completion:${normalizeCompletion(String(completion))}`,
  ];
}

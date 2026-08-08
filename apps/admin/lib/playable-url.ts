/** Match server `isPlayableMediaUrl` in online-drama.util.ts */

const PLAYABLE_RE = /\.(m3u8|mp4|webm|mov|m4v|mkv)(\?|$)/i;
const STREAM_PATH_RE = /\/(hls|playlist|index\.m3u8|master\.m3u8)\b/i;

export function isPlayableMediaUrl(url: string | undefined | null): boolean {
  const u = String(url || "").trim();
  if (!u) return false;
  return PLAYABLE_RE.test(u) || STREAM_PATH_RE.test(u);
}

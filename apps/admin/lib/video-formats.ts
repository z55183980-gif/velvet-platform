/** Extensions / accept string for admin episode video uploads (aligned with API VIDEO_EXT). */
export const VIDEO_EXT_RE =
  /\.(mp4|mov|mkv|webm|m4v|avi|3gp|3g2|wmv|flv|f4v|ts|m2ts|mts|mpg|mpeg|ogv|asf)$/i;

export const VIDEO_ACCEPT = [
  "video/*",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/x-msvideo",
  "video/3gpp",
  "video/3gpp2",
  "video/x-ms-wmv",
  "video/x-flv",
  "video/mp2t",
  "video/mpeg",
  "video/ogg",
  "video/x-ms-asf",
  ".mp4",
  ".mov",
  ".mkv",
  ".webm",
  ".m4v",
  ".avi",
  ".3gp",
  ".3g2",
  ".wmv",
  ".flv",
  ".f4v",
  ".ts",
  ".m2ts",
  ".mts",
  ".mpg",
  ".mpeg",
  ".ogv",
  ".asf",
].join(",");

export function isVideoFile(f: File) {
  return VIDEO_EXT_RE.test(f.name) || f.type.startsWith("video/");
}

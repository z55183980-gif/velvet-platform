/** True when the drama cannot be opened (offline / deleted / not LIVE). */
export function isDramaUnavailable(
  drama: { status?: string | null } | null | undefined,
): boolean {
  if (!drama) return true;
  // Older payloads without status stay openable until API is upgraded.
  if (drama.status == null || drama.status === "") return false;
  return drama.status !== "LIVE";
}

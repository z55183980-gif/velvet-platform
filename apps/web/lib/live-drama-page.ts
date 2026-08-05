import { headers } from "next/headers";
import { LIVE_DRAMA_CHECKED_HEADER, liveDramaExists } from "./live-drama";

/**
 * Page gate: trust middleware probe when present (exists/unavailable — missing already
 * rewritten to hard 404). Otherwise probe once for non-middleware entry points.
 * Keep out of live-drama.ts so Edge middleware can import the probe without next/headers.
 */
export async function liveDramaPageOk(id: string): Promise<boolean> {
  const checked = (await headers()).get(LIVE_DRAMA_CHECKED_HEADER);
  if (checked === "1") return true;
  return liveDramaExists(id);
}

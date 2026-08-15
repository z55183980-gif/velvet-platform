import * as path from 'path';
import { VIDEO_EXT } from '../admin/local-import.util';

/** Server-side yt-dlp and direct-R2 staging names never carry a tenant prefix. */
const SERVER_STAGED_UPLOAD_RE = /^\d{13}-[a-f0-9]{16}\.[a-z0-9]+$/i;

export function canCleanupUploadedSource(
  basename: string,
  ownerUserId?: bigint | null,
) {
  const owner = ownerUserId != null ? ownerUserId.toString() : '';
  if (owner && basename.startsWith(`${owner}-`)) return true;
  return (
    SERVER_STAGED_UPLOAD_RE.test(basename) &&
    VIDEO_EXT.has(path.extname(basename).toLowerCase())
  );
}

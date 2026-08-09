import { diskStorage } from 'multer';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { VIDEO_EXT, VIDEO_MIME_BY_EXT } from '../admin/local-import.util';

/** Hard cap per request — large enough for short drama, small enough to blunt disk DoS. */
export const VIDEO_UPLOAD_MAX_BYTES = Number(
  process.env.VIDEO_UPLOAD_MAX_BYTES || 80 * 1024 * 1024,
);

function multipartTempDir(): string {
  const root = path.resolve(process.env.STORAGE_ROOT || path.join(process.cwd(), 'storage'));
  const dir = path.join(root, '.multipart');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Large media must never be buffered in the Node process. Files land in a
 * private staging directory and are moved into their final location only
 * after controller/service authorization succeeds.
 */
export const multipartDiskStorage = diskStorage({
  destination: (_req, _file, cb) => {
    try {
      cb(null, multipartTempDir());
    } catch (error) {
      cb(error as Error, '');
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  },
});

export const videoDiskStorage = multipartDiskStorage;

export function videoFileFilter(
  _req: unknown,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const mime = String(file.mimetype || '').toLowerCase();
  const allowedMime = new Set([
    ...Object.values(VIDEO_MIME_BY_EXT),
    'application/octet-stream',
  ]);
  const accepted = VIDEO_EXT.has(ext) && (!mime || allowedMime.has(mime));
  cb(accepted ? null : new Error(`unsupported video upload: ${ext || mime}`), accepted);
}

export function cleanupMultipartFiles(
  files: Express.Multer.File | Express.Multer.File[] | null | undefined,
) {
  for (const file of Array.isArray(files) ? files : files ? [files] : []) {
    const stagedPath = file.path ? path.resolve(file.path) : '';
    if (!stagedPath) continue;
    const stagingRoot = path.resolve(multipartTempDir());
    if (stagedPath !== stagingRoot && !stagedPath.startsWith(stagingRoot + path.sep)) continue;
    try {
      fs.rmSync(stagedPath, { force: true });
    } catch {
      // Best effort: the file may already have been moved into its final location.
    }
  }
}

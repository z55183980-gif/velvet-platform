-- Add cooperative cancellation states for persisted yt-dlp transfer jobs.
ALTER TYPE "YtdlpTransferJobStatus" ADD VALUE IF NOT EXISTS 'CANCEL_REQUESTED';
ALTER TYPE "YtdlpTransferJobStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- Add R2 to drama source type enum (must commit before backfill uses it).
ALTER TYPE "DramaSourceType" ADD VALUE IF NOT EXISTS 'R2';

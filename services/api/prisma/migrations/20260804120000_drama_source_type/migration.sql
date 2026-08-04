-- AlterTable
CREATE TYPE "DramaSourceType" AS ENUM ('LOCAL', 'ONLINE');

ALTER TABLE "dramas" ADD COLUMN "sourceType" "DramaSourceType" NOT NULL DEFAULT 'LOCAL';

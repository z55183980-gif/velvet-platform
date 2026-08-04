-- AlterTable
CREATE TYPE "DramaLockMode" AS ENUM ('FREE_FIRST_N', 'VIP_ALL', 'ALL_FREE');

ALTER TABLE "dramas" ADD COLUMN "lockMode" "DramaLockMode";

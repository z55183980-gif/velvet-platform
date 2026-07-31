-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BANNED');

-- CreateEnum
CREATE TYPE "CreatorType" AS ENUM ('OFFICIAL', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CreatorStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BANNED');

-- CreateEnum
CREATE TYPE "DramaStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'LIVE', 'OFFLINE', 'REJECTED');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('PENDING', 'UPLOADING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "TranscodeStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "TxType" AS ENUM ('TOPUP', 'UNLOCK', 'REFUND');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('TOPUP', 'EPISODE_UNLOCK');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('WALLET', 'STRIPE', 'WECHAT', 'ALIPAY', 'MOMO', 'ZALOPAY', 'VIETQR', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WithdrawStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" BIGSERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "zaloId" TEXT,
    "googleId" TEXT,
    "nickname" TEXT,
    "avatarUrl" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'vi',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creators" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "creatorType" "CreatorType" NOT NULL DEFAULT 'INDIVIDUAL',
    "displayName" TEXT NOT NULL,
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'PENDING',
    "cccdNumber" TEXT,
    "cccdFrontUrl" TEXT,
    "cccdBackUrl" TEXT,
    "faceVerified" BOOLEAN NOT NULL DEFAULT false,
    "taxCode" TEXT,
    "bankAccount" JSONB,
    "bankVerified" BOOLEAN NOT NULL DEFAULT false,
    "revenueShare" DECIMAL(5,4) NOT NULL DEFAULT 0.70,
    "status" "CreatorStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "slug" TEXT NOT NULL,
    "nameVi" TEXT NOT NULL,
    "nameZh" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "dramas" (
    "id" BIGSERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "creatorId" BIGINT NOT NULL,
    "titleVi" TEXT NOT NULL,
    "titleZh" TEXT,
    "descriptionVi" TEXT,
    "descriptionZh" TEXT,
    "categorySlug" TEXT NOT NULL,
    "tags" TEXT[],
    "coverUrl" TEXT,
    "totalEpisodes" INTEGER NOT NULL DEFAULT 0,
    "freeEpisodeCount" INTEGER NOT NULL DEFAULT 3,
    "viewCount" BIGINT NOT NULL DEFAULT 0,
    "unlockCount" BIGINT NOT NULL DEFAULT 0,
    "favoriteCount" BIGINT NOT NULL DEFAULT 0,
    "status" "DramaStatus" NOT NULL DEFAULT 'DRAFT',
    "isOfficial" BOOLEAN NOT NULL DEFAULT false,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "dramas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episodes" (
    "id" BIGSERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "dramaId" BIGINT NOT NULL,
    "episodeNumber" INTEGER NOT NULL,
    "title" TEXT,
    "hlsUrl" TEXT,
    "thumbnailUrl" TEXT,
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "priceVnd" BIGINT NOT NULL DEFAULT 0,
    "uploadStatus" "UploadStatus" NOT NULL DEFAULT 'PENDING',
    "transcodeStatus" "TranscodeStatus" NOT NULL DEFAULT 'PENDING',
    "originalUrl" TEXT,
    "viewCount" BIGINT NOT NULL DEFAULT 0,
    "unlockCount" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "episodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_unlocks" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "episodeId" BIGINT NOT NULL,
    "orderId" BIGINT,
    "unlockedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_unlocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorites" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "dramaId" BIGINT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watch_history" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "episodeId" BIGINT NOT NULL,
    "dramaId" BIGINT NOT NULL,
    "progressSec" INTEGER NOT NULL DEFAULT 0,
    "watchedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watch_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "userId" BIGINT NOT NULL,
    "balanceVnd" BIGINT NOT NULL DEFAULT 0,
    "totalRecharged" BIGINT NOT NULL DEFAULT 0,
    "totalSpent" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" BIGSERIAL NOT NULL,
    "walletUserId" BIGINT NOT NULL,
    "type" "TxType" NOT NULL,
    "amountVnd" BIGINT NOT NULL,
    "orderId" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "remark" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" BIGSERIAL NOT NULL,
    "orderNo" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "creatorId" BIGINT,
    "orderType" "OrderType" NOT NULL,
    "episodeId" BIGINT,
    "dramaId" BIGINT,
    "amountVnd" BIGINT NOT NULL,
    "creatorIncomeVnd" BIGINT NOT NULL,
    "platformFeeVnd" BIGINT NOT NULL,
    "payCurrency" TEXT NOT NULL,
    "payAmount" DECIMAL(18,2),
    "fxRate" DECIMAL(18,8),
    "fxSource" TEXT,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "externalRef" TEXT,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creator_earnings" (
    "creatorId" BIGINT NOT NULL,
    "availableVnd" BIGINT NOT NULL DEFAULT 0,
    "pendingVnd" BIGINT NOT NULL DEFAULT 0,
    "withdrawnVnd" BIGINT NOT NULL DEFAULT 0,
    "totalEarnedVnd" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creator_earnings_pkey" PRIMARY KEY ("creatorId")
);

-- CreateTable
CREATE TABLE "withdraw_requests" (
    "id" BIGSERIAL NOT NULL,
    "requestNo" TEXT NOT NULL,
    "creatorId" BIGINT NOT NULL,
    "amountVnd" BIGINT NOT NULL,
    "bankInfo" JSONB NOT NULL,
    "status" "WithdrawStatus" NOT NULL DEFAULT 'PENDING',
    "rejectReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "pitRate" DECIMAL(5,4),
    "pitVnd" BIGINT DEFAULT 0,
    "netVnd" BIGINT DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdraw_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "banners" (
    "id" BIGSERIAL NOT NULL,
    "titleVi" TEXT NOT NULL,
    "titleZh" TEXT,
    "imageUrl" TEXT NOT NULL,
    "linkUrl" TEXT,
    "dramaId" BIGINT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "banners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_reconciliations" (
    "id" BIGSERIAL NOT NULL,
    "date" DATE NOT NULL,
    "provider" TEXT NOT NULL,
    "localPaidCnt" INTEGER NOT NULL,
    "remotePaidCnt" INTEGER NOT NULL,
    "diffJson" JSONB,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_uuid_key" ON "users"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_zaloId_key" ON "users"("zaloId");

-- CreateIndex
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");

-- CreateIndex
CREATE INDEX "users_phone_idx" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_zaloId_idx" ON "users"("zaloId");

-- CreateIndex
CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "creators_userId_key" ON "creators"("userId");

-- CreateIndex
CREATE INDEX "creators_creatorType_idx" ON "creators"("creatorType");

-- CreateIndex
CREATE INDEX "creators_kycStatus_idx" ON "creators"("kycStatus");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "categories_isActive_sortOrder_idx" ON "categories"("isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "dramas_uuid_key" ON "dramas"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "dramas_slug_key" ON "dramas"("slug");

-- CreateIndex
CREATE INDEX "dramas_status_publishedAt_idx" ON "dramas"("status", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "dramas_categorySlug_status_idx" ON "dramas"("categorySlug", "status");

-- CreateIndex
CREATE INDEX "dramas_creatorId_idx" ON "dramas"("creatorId");

-- CreateIndex
CREATE INDEX "dramas_isOfficial_isFeatured_status_idx" ON "dramas"("isOfficial", "isFeatured", "status");

-- CreateIndex
CREATE UNIQUE INDEX "episodes_uuid_key" ON "episodes"("uuid");

-- CreateIndex
CREATE INDEX "episodes_dramaId_episodeNumber_idx" ON "episodes"("dramaId", "episodeNumber");

-- CreateIndex
CREATE INDEX "episodes_transcodeStatus_idx" ON "episodes"("transcodeStatus");

-- CreateIndex
CREATE UNIQUE INDEX "episodes_dramaId_episodeNumber_key" ON "episodes"("dramaId", "episodeNumber");

-- CreateIndex
CREATE INDEX "user_unlocks_userId_unlockedAt_idx" ON "user_unlocks"("userId", "unlockedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "user_unlocks_userId_episodeId_key" ON "user_unlocks"("userId", "episodeId");

-- CreateIndex
CREATE INDEX "favorites_userId_createdAt_idx" ON "favorites"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "favorites_userId_dramaId_key" ON "favorites"("userId", "dramaId");

-- CreateIndex
CREATE INDEX "watch_history_userId_watchedAt_idx" ON "watch_history"("userId", "watchedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "watch_history_userId_episodeId_key" ON "watch_history"("userId", "episodeId");

-- CreateIndex
CREATE INDEX "wallet_transactions_walletUserId_createdAt_idx" ON "wallet_transactions"("walletUserId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_orderId_type_key" ON "wallet_transactions"("orderId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "orders_orderNo_key" ON "orders"("orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "orders_idempotencyKey_key" ON "orders"("idempotencyKey");

-- CreateIndex
CREATE INDEX "orders_userId_createdAt_idx" ON "orders"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "orders_creatorId_createdAt_idx" ON "orders"("creatorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "orders_paymentStatus_createdAt_idx" ON "orders"("paymentStatus", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "withdraw_requests_requestNo_key" ON "withdraw_requests"("requestNo");

-- CreateIndex
CREATE INDEX "withdraw_requests_creatorId_createdAt_idx" ON "withdraw_requests"("creatorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "withdraw_requests_status_createdAt_idx" ON "withdraw_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "banners_isActive_startAt_endAt_idx" ON "banners"("isActive", "startAt", "endAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_reconciliations_date_provider_key" ON "payment_reconciliations"("date", "provider");

-- AddForeignKey
ALTER TABLE "creators" ADD CONSTRAINT "creators_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dramas" ADD CONSTRAINT "dramas_categorySlug_fkey" FOREIGN KEY ("categorySlug") REFERENCES "categories"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dramas" ADD CONSTRAINT "dramas_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "creators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_dramaId_fkey" FOREIGN KEY ("dramaId") REFERENCES "dramas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_unlocks" ADD CONSTRAINT "user_unlocks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_unlocks" ADD CONSTRAINT "user_unlocks_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "episodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_unlocks" ADD CONSTRAINT "user_unlocks_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_dramaId_fkey" FOREIGN KEY ("dramaId") REFERENCES "dramas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watch_history" ADD CONSTRAINT "watch_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_walletUserId_fkey" FOREIGN KEY ("walletUserId") REFERENCES "wallets"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "creators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_earnings" ADD CONSTRAINT "creator_earnings_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "creators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdraw_requests" ADD CONSTRAINT "withdraw_requests_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "creators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

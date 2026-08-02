-- CreateEnum
CREATE TYPE "BlacklistReason" AS ENUM ('BLOCKED', 'UNSUBSCRIBED', 'INVALID', 'FAILED');

-- AlterTable
ALTER TABLE "CampaignSendLog" ADD COLUMN     "errorCode" TEXT;

-- AlterTable
ALTER TABLE "WhatsappAccount" ADD COLUMN     "businessManagerId" TEXT,
ADD COLUMN     "companyName" TEXT,
ADD COLUMN     "defaultAttachmentFilename" TEXT,
ADD COLUMN     "defaultAttachmentKey" TEXT,
ADD COLUMN     "defaultAttachmentMimeType" TEXT,
ADD COLUMN     "defaultAttachmentType" TEXT,
ADD COLUMN     "defaultFooter" TEXT,
ADD COLUMN     "defaultTemplateId" TEXT,
ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "logoKey" TEXT,
ADD COLUMN     "messagingLimitTier" TEXT,
ADD COLUMN     "notifyApiFailure" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyBrowser" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyCampaignCompleted" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyCampaignFailed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notifyQualityDrop" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyWebhookOffline" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "tokenCreatedAt" TIMESTAMP(3),
ADD COLUMN     "tokenUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "webhookLastDeliveryAt" TIMESTAMP(3),
ADD COLUMN     "webhookLastErrorAt" TIMESTAMP(3),
ADD COLUMN     "webhookLastErrorMessage" TEXT,
ADD COLUMN     "webhookLastPingAt" TIMESTAMP(3),
ADD COLUMN     "webhookLastReadAt" TIMESTAMP(3),
ADD COLUMN     "webhookVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "workingHours" JSONB,
ADD COLUMN     "workingHoursEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BlacklistedNumber" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "reason" "BlacklistReason" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlacklistedNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BlacklistedNumber_userId_idx" ON "BlacklistedNumber"("userId");

-- CreateIndex
CREATE INDEX "BlacklistedNumber_userId_reason_idx" ON "BlacklistedNumber"("userId", "reason");

-- CreateIndex
CREATE UNIQUE INDEX "BlacklistedNumber_userId_phoneNumber_key" ON "BlacklistedNumber"("userId", "phoneNumber");

-- CreateIndex
CREATE INDEX "AccountAuditLog_userId_idx" ON "AccountAuditLog"("userId");

-- CreateIndex
CREATE INDEX "AccountAuditLog_userId_createdAt_idx" ON "AccountAuditLog"("userId", "createdAt");

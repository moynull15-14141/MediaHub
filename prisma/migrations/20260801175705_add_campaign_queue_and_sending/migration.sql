-- CreateEnum
CREATE TYPE "CampaignSendMode" AS ENUM ('NOW', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "CampaignSendStatus" AS ENUM ('NOT_STARTED', 'SCHEDULED', 'QUEUED', 'SENDING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "QueueJobStatus" AS ENUM ('PENDING', 'WAITING', 'SENDING', 'SENT', 'FAILED', 'RETRY', 'CANCELLED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "MessageDeliveryStatus" AS ENUM ('UNKNOWN', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "queueCompletedAt" TIMESTAMP(3),
ADD COLUMN     "queuePausedAt" TIMESTAMP(3),
ADD COLUMN     "queueStartedAt" TIMESTAMP(3),
ADD COLUMN     "scheduledAt" TIMESTAMP(3),
ADD COLUMN     "sendMode" "CampaignSendMode",
ADD COLUMN     "sendStatus" "CampaignSendStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "timezone" TEXT;

-- AlterTable
ALTER TABLE "WhatsappAccount" ADD COLUMN     "maxConcurrentJobs" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "maxDelaySeconds" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "maxRetries" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "minDelaySeconds" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "sendTimezone" TEXT NOT NULL DEFAULT 'UTC';

-- CreateTable
CREATE TABLE "CampaignQueueJob" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "recipientPhone" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "renderedMessage" TEXT NOT NULL,
    "status" "QueueJobStatus" NOT NULL DEFAULT 'PENDING',
    "deliveryStatus" "MessageDeliveryStatus" NOT NULL DEFAULT 'UNKNOWN',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "nextAttemptAt" TIMESTAMP(3),
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "metaMessageId" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignQueueJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignSendLog" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "QueueJobStatus" NOT NULL,
    "durationMs" INTEGER,
    "errorMessage" TEXT,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignSendLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignQueueJob_metaMessageId_key" ON "CampaignQueueJob"("metaMessageId");

-- CreateIndex
CREATE INDEX "CampaignQueueJob_campaignId_idx" ON "CampaignQueueJob"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignQueueJob_status_idx" ON "CampaignQueueJob"("status");

-- CreateIndex
CREATE INDEX "CampaignQueueJob_campaignId_status_idx" ON "CampaignQueueJob"("campaignId", "status");

-- CreateIndex
CREATE INDEX "CampaignQueueJob_nextAttemptAt_idx" ON "CampaignQueueJob"("nextAttemptAt");

-- CreateIndex
CREATE INDEX "CampaignSendLog_jobId_idx" ON "CampaignSendLog"("jobId");

-- CreateIndex
CREATE INDEX "CampaignSendLog_campaignId_idx" ON "CampaignSendLog"("campaignId");

-- CreateIndex
CREATE INDEX "Campaign_sendStatus_idx" ON "Campaign"("sendStatus");

-- CreateIndex
CREATE INDEX "Campaign_sendStatus_scheduledAt_idx" ON "Campaign"("sendStatus", "scheduledAt");

-- AddForeignKey
ALTER TABLE "CampaignQueueJob" ADD CONSTRAINT "CampaignQueueJob_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSendLog" ADD CONSTRAINT "CampaignSendLog_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "CampaignQueueJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

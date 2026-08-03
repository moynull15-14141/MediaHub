-- CreateEnum
CREATE TYPE "WebhookHealthStatus" AS ENUM ('HEALTHY', 'WARNING', 'CRITICAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'RETRY_SCHEDULED', 'DEAD_LETTERED');

-- AlterEnum
ALTER TYPE "MessageDeliveryStatus" ADD VALUE 'DELETED';

-- AlterTable
ALTER TABLE "CampaignQueueJob" ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "conversationOrigin" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "lastStatusEventAt" TIMESTAMP(3),
ADD COLUMN     "lastWarningAt" TIMESTAMP(3),
ADD COLUMN     "lastWarningCode" TEXT,
ADD COLUMN     "lastWarningMessage" TEXT,
ADD COLUMN     "pricingCategory" TEXT,
ADD COLUMN     "pricingModel" TEXT;

-- AlterTable
ALTER TABLE "WhatsappAccount" ADD COLUMN     "webhookHealthStatus" "WebhookHealthStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "webhookLastHealthCheckAt" TIMESTAMP(3),
ADD COLUMN     "webhookLastSignatureFailureAt" TIMESTAMP(3),
ADD COLUMN     "webhookLastVerificationAttempt" TIMESTAMP(3),
ADD COLUMN     "webhookNextSubscriptionRetryAt" TIMESTAMP(3),
ADD COLUMN     "webhookNotificationSentAt" TIMESTAMP(3),
ADD COLUMN     "webhookNotificationType" TEXT,
ADD COLUMN     "webhookSignatureFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "webhookSubscriptionAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "webhookSubscriptionError" TEXT,
ADD COLUMN     "webhookVerificationError" TEXT,
ADD COLUMN     "webhookVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "wamid" TEXT,
    "eventType" TEXT NOT NULL,
    "workspaceId" TEXT,
    "accountId" TEXT,
    "wabaId" TEXT,
    "phoneNumberId" TEXT,
    "payloadHash" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 4,
    "nextRetryAt" TIMESTAMP(3),
    "duplicateAttempts" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processingTimeMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDeadLetter" (
    "id" TEXT NOT NULL,
    "webhookEventId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "accountId" TEXT,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "replayCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WebhookDeadLetter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_eventId_key" ON "WebhookEvent"("eventId");

-- CreateIndex
CREATE INDEX "WebhookEvent_wamid_idx" ON "WebhookEvent"("wamid");

-- CreateIndex
CREATE INDEX "WebhookEvent_workspaceId_idx" ON "WebhookEvent"("workspaceId");

-- CreateIndex
CREATE INDEX "WebhookEvent_accountId_idx" ON "WebhookEvent"("accountId");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_idx" ON "WebhookEvent"("status");

-- CreateIndex
CREATE INDEX "WebhookEvent_processedAt_idx" ON "WebhookEvent"("processedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_nextRetryAt_idx" ON "WebhookEvent"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_receivedAt_idx" ON "WebhookEvent"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDeadLetter_webhookEventId_key" ON "WebhookDeadLetter"("webhookEventId");

-- CreateIndex
CREATE INDEX "WebhookDeadLetter_workspaceId_idx" ON "WebhookDeadLetter"("workspaceId");

-- CreateIndex
CREATE INDEX "WebhookDeadLetter_accountId_idx" ON "WebhookDeadLetter"("accountId");

-- CreateIndex
CREATE INDEX "WebhookDeadLetter_resolvedAt_idx" ON "WebhookDeadLetter"("resolvedAt");

-- CreateIndex
CREATE INDEX "WebhookDeadLetter_createdAt_idx" ON "WebhookDeadLetter"("createdAt");

-- CreateIndex
CREATE INDEX "CampaignQueueJob_deliveryStatus_lastStatusEventAt_idx" ON "CampaignQueueJob"("deliveryStatus", "lastStatusEventAt");

-- CreateIndex
CREATE INDEX "WhatsappAccount_webhookHealthStatus_idx" ON "WhatsappAccount"("webhookHealthStatus");

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WhatsappAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDeadLetter" ADD CONSTRAINT "WebhookDeadLetter_webhookEventId_fkey" FOREIGN KEY ("webhookEventId") REFERENCES "WebhookEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

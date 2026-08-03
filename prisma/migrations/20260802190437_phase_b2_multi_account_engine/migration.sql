-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "whatsappAccountId" TEXT;

-- AlterTable
ALTER TABLE "WhatsappAccount" ADD COLUMN     "currentDailySent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dailyLimit" INTEGER,
ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastDailyReset" TIMESTAMP(3),
ADD COLUMN     "lastHealthCheck" TIMESTAMP(3),
ADD COLUMN     "lastTokenRefresh" TIMESTAMP(3),
ADD COLUMN     "lastWebhookSync" TIMESTAMP(3),
ADD COLUMN     "messagingLimit" INTEGER,
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sendingEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "tokenExpiringSoon" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "webhookSubscribed" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Campaign_whatsappAccountId_idx" ON "Campaign"("whatsappAccountId");

-- CreateIndex
CREATE INDEX "WhatsappAccount_workspaceId_isDefault_idx" ON "WhatsappAccount"("workspaceId", "isDefault");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_whatsappAccountId_fkey" FOREIGN KEY ("whatsappAccountId") REFERENCES "WhatsappAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data migration: mark the earliest-connected account in each workspace as
-- the default sending account, so existing workspaces with >=1 account get
-- a sane isDefault without any manual step. Skips workspaces that somehow
-- already have a default (idempotent / safe to re-run).
UPDATE "WhatsappAccount" wa
SET "isDefault" = true
WHERE wa.id = (
  SELECT id FROM "WhatsappAccount" wa2
  WHERE wa2."workspaceId" = wa."workspaceId"
  ORDER BY wa2."createdAt" ASC LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM "WhatsappAccount" wa3
  WHERE wa3."workspaceId" = wa."workspaceId" AND wa3."isDefault" = true
);

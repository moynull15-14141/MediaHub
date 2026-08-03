-- CreateEnum
CREATE TYPE "WhatsappTokenStatus" AS ENUM ('CONNECTED', 'EXPIRING', 'EXPIRED', 'INVALID', 'RECONNECT_REQUIRED', 'PERMISSION_REVOKED', 'DISCONNECTED');

-- AlterTable
ALTER TABLE "WhatsappAccount" ADD COLUMN     "connectionStateUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "consecutiveValidationFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastFailedValidation" TIMESTAMP(3),
ADD COLUMN     "lastReconnectAt" TIMESTAMP(3),
ADD COLUMN     "lastReconnectRequiredAt" TIMESTAMP(3),
ADD COLUMN     "lastSuccessfulValidation" TIMESTAMP(3),
ADD COLUMN     "lastTokenValidation" TIMESTAMP(3),
ADD COLUMN     "notificationSentAt" TIMESTAMP(3),
ADD COLUMN     "notificationType" TEXT,
ADD COLUMN     "reconnectReason" TEXT,
ADD COLUMN     "tokenStateVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tokenStatus" "WhatsappTokenStatus" NOT NULL DEFAULT 'CONNECTED',
ADD COLUMN     "validationFailureReason" TEXT,
ADD COLUMN     "validationLatency" INTEGER;

-- CreateIndex
CREATE INDEX "WhatsappAccount_tokenStatus_idx" ON "WhatsappAccount"("tokenStatus");

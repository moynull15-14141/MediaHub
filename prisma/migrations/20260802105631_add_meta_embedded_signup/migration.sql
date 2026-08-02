-- CreateEnum
CREATE TYPE "WhatsappConnectionSource" AS ENUM ('MANUAL', 'META_EMBEDDED_SIGNUP');

-- CreateEnum
CREATE TYPE "WhatsappConnectionHealth" AS ENUM ('CONNECTED', 'DISCONNECTED', 'EXPIRED', 'PERMISSION_ERROR');

-- AlterTable
ALTER TABLE "WhatsappAccount" ADD COLUMN     "accountReviewStatus" TEXT,
ADD COLUMN     "businessVerificationStatus" TEXT,
ADD COLUMN     "connectionHealth" "WhatsappConnectionHealth" NOT NULL DEFAULT 'DISCONNECTED',
ADD COLUMN     "connectionSource" "WhatsappConnectionSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "grantedScopes" TEXT,
ADD COLUMN     "lastValidationAt" TIMESTAMP(3),
ADD COLUMN     "lastValidationStatus" TEXT,
ADD COLUMN     "metaBusinessId" TEXT,
ADD COLUMN     "metaBusinessName" TEXT,
ADD COLUMN     "tokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "verifiedName" TEXT;

-- CreateTable
CREATE TABLE "MetaOAuthState" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetaOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MetaOAuthState_state_key" ON "MetaOAuthState"("state");

-- CreateIndex
CREATE INDEX "MetaOAuthState_workspaceId_idx" ON "MetaOAuthState"("workspaceId");

-- CreateIndex
CREATE INDEX "MetaOAuthState_expiresAt_idx" ON "MetaOAuthState"("expiresAt");

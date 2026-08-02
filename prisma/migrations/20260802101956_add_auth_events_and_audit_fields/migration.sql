-- CreateEnum
CREATE TYPE "AuthEventType" AS ENUM ('LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'LOGOUT_ALL', 'TOKEN_REFRESH', 'PASSWORD_CHANGE', 'REGISTER');

-- AlterTable
ALTER TABLE "AccountAuditLog" ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "userAgent" TEXT;

-- CreateTable
CREATE TABLE "AuthEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "event" "AuthEventType" NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "deviceType" TEXT,
    "browser" TEXT,
    "os" TEXT,
    "country" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthEvent_userId_idx" ON "AuthEvent"("userId");

-- CreateIndex
CREATE INDEX "AuthEvent_email_idx" ON "AuthEvent"("email");

-- CreateIndex
CREATE INDEX "AuthEvent_userId_createdAt_idx" ON "AuthEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuthEvent_email_event_createdAt_idx" ON "AuthEvent"("email", "event", "createdAt");

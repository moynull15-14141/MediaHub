-- CreateEnum
CREATE TYPE "TemplateCategory" AS ENUM ('MARKETING', 'PROMOTION', 'REMINDER', 'GREETING', 'ANNOUNCEMENT', 'SUPPORT', 'INVOICE', 'OTP');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "customFields" JSONB;

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "TemplateCategory" NOT NULL DEFAULT 'MARKETING',
    "messageText" TEXT NOT NULL,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageTemplate_userId_idx" ON "MessageTemplate"("userId");

-- CreateIndex
CREATE INDEX "MessageTemplate_userId_category_idx" ON "MessageTemplate"("userId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_userId_name_key" ON "MessageTemplate"("userId", "name");

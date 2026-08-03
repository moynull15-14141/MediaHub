-- AlterTable
ALTER TABLE "WhatsappAccount" ADD COLUMN     "lastFailoverAt" TIMESTAMP(3),
ADD COLUMN     "lastFailoverReason" TEXT,
ADD COLUMN     "sendingDisabledReason" TEXT;

-- AlterTable
ALTER TABLE "WhatsappAccount" ADD COLUMN     "batchSize" INTEGER NOT NULL DEFAULT 1000,
ADD COLUMN     "retryDelaySeconds" INTEGER NOT NULL DEFAULT 30;

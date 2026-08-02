-- AlterTable
ALTER TABLE "CampaignQueueJob" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "readAt" TIMESTAMP(3);

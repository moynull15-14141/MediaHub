-- AlterTable
ALTER TABLE "ConversionJob" ADD COLUMN     "anonId" TEXT;

-- CreateIndex
CREATE INDEX "ConversionJob_userId_idx" ON "ConversionJob"("userId");

-- CreateIndex
CREATE INDEX "ConversionJob_anonId_idx" ON "ConversionJob"("anonId");

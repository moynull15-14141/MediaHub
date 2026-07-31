-- CreateEnum
CREATE TYPE "ImageJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "ImageJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "anonId" TEXT,
    "originalFilename" TEXT NOT NULL,
    "inputFormat" TEXT NOT NULL,
    "outputFormat" TEXT,
    "fileSizeBytes" BIGINT,
    "width" INTEGER,
    "height" INTEGER,
    "status" "ImageJobStatus" NOT NULL DEFAULT 'QUEUED',
    "errorMessage" TEXT,
    "inputPath" TEXT,
    "outputPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "downloadExpiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImageJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImageJob_status_idx" ON "ImageJob"("status");

-- CreateIndex
CREATE INDEX "ImageJob_createdAt_idx" ON "ImageJob"("createdAt");

-- CreateIndex
CREATE INDEX "ImageJob_userId_idx" ON "ImageJob"("userId");

-- CreateIndex
CREATE INDEX "ImageJob_anonId_idx" ON "ImageJob"("anonId");

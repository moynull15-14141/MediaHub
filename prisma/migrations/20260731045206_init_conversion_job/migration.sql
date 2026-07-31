-- CreateEnum
CREATE TYPE "ConversionStatus" AS ENUM ('QUEUED', 'CONVERTING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ConversionJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "originalFilename" TEXT NOT NULL,
    "inputFormat" TEXT NOT NULL,
    "outputFormat" TEXT,
    "fileSizeBytes" BIGINT,
    "durationSeconds" DOUBLE PRECISION,
    "resolution" TEXT,
    "status" "ConversionStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "inputPath" TEXT,
    "outputPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "downloadExpiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversionJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversionJob_status_idx" ON "ConversionJob"("status");

-- CreateIndex
CREATE INDEX "ConversionJob_createdAt_idx" ON "ConversionJob"("createdAt");

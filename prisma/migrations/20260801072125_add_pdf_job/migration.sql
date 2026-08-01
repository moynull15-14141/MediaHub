-- CreateEnum
CREATE TYPE "PdfJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PdfOperation" AS ENUM ('MERGE', 'SPLIT', 'COMPRESS', 'PDF_TO_JPG', 'JPG_TO_PDF', 'ROTATE', 'DELETE_PAGES', 'REARRANGE', 'PROTECT', 'UNLOCK');

-- CreateTable
CREATE TABLE "PdfJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "anonId" TEXT,
    "operation" "PdfOperation" NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "inputFormat" TEXT NOT NULL,
    "outputFormat" TEXT,
    "fileSizeBytes" BIGINT,
    "outputFileSizeBytes" BIGINT,
    "pageCount" INTEGER,
    "status" "PdfJobStatus" NOT NULL DEFAULT 'QUEUED',
    "errorMessage" TEXT,
    "resultMessage" TEXT,
    "inputPaths" TEXT[],
    "thumbnailPaths" TEXT[],
    "outputPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "downloadExpiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PdfJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PdfJob_status_idx" ON "PdfJob"("status");

-- CreateIndex
CREATE INDEX "PdfJob_createdAt_idx" ON "PdfJob"("createdAt");

-- CreateIndex
CREATE INDEX "PdfJob_userId_idx" ON "PdfJob"("userId");

-- CreateIndex
CREATE INDEX "PdfJob_anonId_idx" ON "PdfJob"("anonId");

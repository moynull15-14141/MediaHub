-- CreateEnum
CREATE TYPE "ReportFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ReportDataset" AS ENUM ('OVERVIEW', 'CAMPAIGNS', 'CONTACTS', 'TEMPLATES', 'QUEUE', 'API', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('PDF', 'XLSX', 'CSV');

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "templateId" TEXT;

-- CreateTable
CREATE TABLE "ScheduledReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "frequency" "ReportFrequency" NOT NULL,
    "dataset" "ReportDataset" NOT NULL,
    "format" "ReportFormat" NOT NULL,
    "filters" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scheduledReportId" TEXT,
    "name" TEXT NOT NULL,
    "dataset" "ReportDataset" NOT NULL,
    "format" "ReportFormat" NOT NULL,
    "filters" JSONB,
    "fileSizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "generatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduledReport_userId_idx" ON "ScheduledReport"("userId");

-- CreateIndex
CREATE INDEX "ScheduledReport_enabled_nextRunAt_idx" ON "ScheduledReport"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "ReportHistory_userId_idx" ON "ReportHistory"("userId");

-- CreateIndex
CREATE INDEX "ReportHistory_userId_createdAt_idx" ON "ReportHistory"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Campaign_userId_templateId_idx" ON "Campaign"("userId", "templateId");

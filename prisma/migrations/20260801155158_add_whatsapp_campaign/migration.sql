-- CreateEnum
CREATE TYPE "WhatsappAccountStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "WhatsappHealthStatus" AS ENUM ('HEALTHY', 'WARNING', 'UNHEALTHY', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ImportSource" AS ENUM ('CSV', 'XLSX', 'MANUAL');

-- CreateTable
CREATE TABLE "WhatsappAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "wabaId" TEXT,
    "displayPhoneNumber" TEXT,
    "businessName" TEXT,
    "qualityRating" TEXT,
    "healthStatus" "WhatsappHealthStatus" NOT NULL DEFAULT 'UNKNOWN',
    "status" "WhatsappAccountStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "accessTokenEncrypted" TEXT NOT NULL,
    "lastErrorMessage" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "defaultCountryCode" TEXT,
    "autoSkipDuplicates" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "email" TEXT,
    "company" TEXT,
    "notes" TEXT,
    "status" "ContactStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Label" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3b82f6',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Label_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactGroup" (
    "contactId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "ContactGroup_pkey" PRIMARY KEY ("contactId","groupId")
);

-- CreateTable
CREATE TABLE "ContactLabel" (
    "contactId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,

    CONSTRAINT "ContactLabel_pkey" PRIMARY KEY ("contactId","labelId")
);

-- CreateTable
CREATE TABLE "ContactImportBatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "filename" TEXT,
    "source" "ImportSource" NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "importedCount" INTEGER NOT NULL,
    "duplicateCount" INTEGER NOT NULL,
    "invalidCount" INTEGER NOT NULL,
    "skippedCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappAccount_userId_key" ON "WhatsappAccount"("userId");

-- CreateIndex
CREATE INDEX "Contact_userId_idx" ON "Contact"("userId");

-- CreateIndex
CREATE INDEX "Contact_userId_status_idx" ON "Contact"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_userId_phoneNumber_key" ON "Contact"("userId", "phoneNumber");

-- CreateIndex
CREATE INDEX "Group_userId_idx" ON "Group"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Group_userId_name_key" ON "Group"("userId", "name");

-- CreateIndex
CREATE INDEX "Label_userId_idx" ON "Label"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Label_userId_name_key" ON "Label"("userId", "name");

-- CreateIndex
CREATE INDEX "ContactGroup_groupId_idx" ON "ContactGroup"("groupId");

-- CreateIndex
CREATE INDEX "ContactLabel_labelId_idx" ON "ContactLabel"("labelId");

-- CreateIndex
CREATE INDEX "ContactImportBatch_userId_idx" ON "ContactImportBatch"("userId");

-- CreateIndex
CREATE INDEX "ContactImportBatch_createdAt_idx" ON "ContactImportBatch"("createdAt");

-- AddForeignKey
ALTER TABLE "ContactGroup" ADD CONSTRAINT "ContactGroup_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactGroup" ADD CONSTRAINT "ContactGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactLabel" ADD CONSTRAINT "ContactLabel_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactLabel" ADD CONSTRAINT "ContactLabel_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "Label"("id") ON DELETE CASCADE ON UPDATE CASCADE;

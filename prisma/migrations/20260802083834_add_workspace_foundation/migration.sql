-- CreateEnum
CREATE TYPE "WorkspaceStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');
CREATE TYPE "WorkspacePlan" AS ENUM ('FREE', 'STARTER', 'PRO', 'ENTERPRISE');
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER');
CREATE TYPE "WorkspaceInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateTable: Workspace tables first (no dependency on the business tables below)
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "address" TEXT,
    "taxId" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "country" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "businessType" TEXT,
    "status" "WorkspaceStatus" NOT NULL DEFAULT 'ACTIVE',
    "plan" "WorkspacePlan" NOT NULL DEFAULT 'FREE',
    "storageUsedBytes" BIGINT NOT NULL DEFAULT 0,
    "storageLimitBytes" BIGINT NOT NULL DEFAULT 5368709120,
    "messageUsed" INTEGER NOT NULL DEFAULT 0,
    "messageLimit" INTEGER NOT NULL DEFAULT 1000,
    "contactLimit" INTEGER NOT NULL DEFAULT 1000,
    "campaignLimit" INTEGER NOT NULL DEFAULT 50,
    "memberLimit" INTEGER NOT NULL DEFAULT 5,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'OWNER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceInvitation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'OPERATOR',
    "token" TEXT NOT NULL,
    "status" "WorkspaceInviteStatus" NOT NULL DEFAULT 'PENDING',
    "invitedBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");
CREATE INDEX "Workspace_slug_idx" ON "Workspace"("slug");
CREATE INDEX "Workspace_status_idx" ON "Workspace"("status");
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");
CREATE INDEX "WorkspaceMember_workspaceId_idx" ON "WorkspaceMember"("workspaceId");
CREATE INDEX "WorkspaceMember_workspaceId_role_idx" ON "WorkspaceMember"("workspaceId", "role");
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");
CREATE UNIQUE INDEX "WorkspaceInvitation_token_key" ON "WorkspaceInvitation"("token");
CREATE INDEX "WorkspaceInvitation_workspaceId_idx" ON "WorkspaceInvitation"("workspaceId");
CREATE INDEX "WorkspaceInvitation_email_idx" ON "WorkspaceInvitation"("email");
CREATE INDEX "WorkspaceInvitation_workspaceId_status_idx" ON "WorkspaceInvitation"("workspaceId", "status");

ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceInvitation" ADD CONSTRAINT "WorkspaceInvitation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: User gets lastWorkspaceId (nullable, always safe)
ALTER TABLE "User" ADD COLUMN "lastWorkspaceId" TEXT;

-- AlterTable: add workspaceId as NULLABLE first on every existing business
-- table, so this migration doesn't fail against rows that already exist.
ALTER TABLE "AccountAuditLog" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "BlacklistedNumber" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Contact" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "ContactImportBatch" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Group" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Label" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "MessageTemplate" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "ReportHistory" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "ScheduledReport" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "WhatsappAccount" ADD COLUMN "workspaceId" TEXT;

-- Data migration (Part 3): one default Workspace + one OWNER WorkspaceMember
-- per existing user, so nothing is orphaned. Slug is derived from the email
-- local-part with an id suffix to guarantee uniqueness.
INSERT INTO "Workspace" (id, name, slug, timezone, language, currency, status, plan,
  "storageUsedBytes", "storageLimitBytes", "messageUsed", "messageLimit",
  "contactLimit", "campaignLimit", "memberLimit", "createdBy", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  INITCAP(REPLACE(SPLIT_PART(email, '@', 1), '.', ' ')) || '''s Workspace',
  LOWER(REGEXP_REPLACE(SPLIT_PART(email, '@', 1), '[^a-zA-Z0-9]', '', 'g')) || '-' || SUBSTR(id, 1, 8),
  'UTC', 'en', 'USD', 'ACTIVE', 'FREE',
  0, 5368709120, 0, 1000, 1000, 50, 5,
  id, "createdAt", now()
FROM "User";

INSERT INTO "WorkspaceMember" (id, "workspaceId", "userId", role, "isActive", "joinedAt")
SELECT gen_random_uuid()::text, w.id, w."createdBy", 'OWNER', true, w."createdAt"
FROM "Workspace" w;

UPDATE "User" u SET "lastWorkspaceId" = w.id FROM "Workspace" w WHERE w."createdBy" = u.id;

-- Backfill workspaceId on every existing business row by joining back to the
-- workspace created for that row's owning user above.
UPDATE "AccountAuditLog" t SET "workspaceId" = w.id FROM "Workspace" w WHERE w."createdBy" = t."userId";
UPDATE "BlacklistedNumber" t SET "workspaceId" = w.id FROM "Workspace" w WHERE w."createdBy" = t."userId";
UPDATE "Campaign" t SET "workspaceId" = w.id FROM "Workspace" w WHERE w."createdBy" = t."userId";
UPDATE "Contact" t SET "workspaceId" = w.id FROM "Workspace" w WHERE w."createdBy" = t."userId";
UPDATE "ContactImportBatch" t SET "workspaceId" = w.id FROM "Workspace" w WHERE w."createdBy" = t."userId";
UPDATE "Group" t SET "workspaceId" = w.id FROM "Workspace" w WHERE w."createdBy" = t."userId";
UPDATE "Label" t SET "workspaceId" = w.id FROM "Workspace" w WHERE w."createdBy" = t."userId";
UPDATE "MessageTemplate" t SET "workspaceId" = w.id FROM "Workspace" w WHERE w."createdBy" = t."userId";
UPDATE "ReportHistory" t SET "workspaceId" = w.id FROM "Workspace" w WHERE w."createdBy" = t."userId";
UPDATE "ScheduledReport" t SET "workspaceId" = w.id FROM "Workspace" w WHERE w."createdBy" = t."userId";
UPDATE "WhatsappAccount" t SET "workspaceId" = w.id FROM "Workspace" w WHERE w."createdBy" = t."userId";

-- Now that every existing row has a workspaceId, enforce NOT NULL.
ALTER TABLE "AccountAuditLog" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "BlacklistedNumber" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "Campaign" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "Contact" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "ContactImportBatch" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "Group" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "Label" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "MessageTemplate" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "ReportHistory" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "ScheduledReport" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "WhatsappAccount" ALTER COLUMN "workspaceId" SET NOT NULL;

-- DropIndex: old userId-scoped uniqueness/indexes being replaced by
-- workspaceId-scoped equivalents below.
DROP INDEX "AccountAuditLog_userId_createdAt_idx";
DROP INDEX "BlacklistedNumber_userId_phoneNumber_key";
DROP INDEX "BlacklistedNumber_userId_reason_idx";
DROP INDEX "Campaign_userId_status_idx";
DROP INDEX "Campaign_userId_templateId_idx";
DROP INDEX "Contact_userId_phoneNumber_key";
DROP INDEX "Contact_userId_status_idx";
DROP INDEX "Group_userId_name_key";
DROP INDEX "Label_userId_name_key";
DROP INDEX "MessageTemplate_userId_category_idx";
DROP INDEX "MessageTemplate_userId_name_key";
DROP INDEX "ReportHistory_userId_createdAt_idx";

-- CreateIndex: new workspaceId-scoped indexes and uniqueness
CREATE INDEX "AccountAuditLog_workspaceId_idx" ON "AccountAuditLog"("workspaceId");
CREATE INDEX "AccountAuditLog_workspaceId_createdAt_idx" ON "AccountAuditLog"("workspaceId", "createdAt");
CREATE INDEX "BlacklistedNumber_workspaceId_idx" ON "BlacklistedNumber"("workspaceId");
CREATE INDEX "BlacklistedNumber_workspaceId_reason_idx" ON "BlacklistedNumber"("workspaceId", "reason");
CREATE UNIQUE INDEX "BlacklistedNumber_workspaceId_phoneNumber_key" ON "BlacklistedNumber"("workspaceId", "phoneNumber");
CREATE INDEX "Campaign_workspaceId_idx" ON "Campaign"("workspaceId");
CREATE INDEX "Campaign_workspaceId_status_idx" ON "Campaign"("workspaceId", "status");
CREATE INDEX "Campaign_workspaceId_templateId_idx" ON "Campaign"("workspaceId", "templateId");
CREATE INDEX "Contact_workspaceId_idx" ON "Contact"("workspaceId");
CREATE INDEX "Contact_workspaceId_status_idx" ON "Contact"("workspaceId", "status");
CREATE UNIQUE INDEX "Contact_workspaceId_phoneNumber_key" ON "Contact"("workspaceId", "phoneNumber");
CREATE INDEX "ContactImportBatch_workspaceId_idx" ON "ContactImportBatch"("workspaceId");
CREATE INDEX "Group_workspaceId_idx" ON "Group"("workspaceId");
CREATE UNIQUE INDEX "Group_workspaceId_name_key" ON "Group"("workspaceId", "name");
CREATE INDEX "Label_workspaceId_idx" ON "Label"("workspaceId");
CREATE UNIQUE INDEX "Label_workspaceId_name_key" ON "Label"("workspaceId", "name");
CREATE INDEX "MessageTemplate_workspaceId_idx" ON "MessageTemplate"("workspaceId");
CREATE INDEX "MessageTemplate_workspaceId_category_idx" ON "MessageTemplate"("workspaceId", "category");
CREATE UNIQUE INDEX "MessageTemplate_workspaceId_name_key" ON "MessageTemplate"("workspaceId", "name");
CREATE INDEX "ReportHistory_workspaceId_idx" ON "ReportHistory"("workspaceId");
CREATE INDEX "ReportHistory_workspaceId_createdAt_idx" ON "ReportHistory"("workspaceId", "createdAt");
CREATE INDEX "ScheduledReport_workspaceId_idx" ON "ScheduledReport"("workspaceId");
CREATE INDEX "WhatsappAccount_workspaceId_idx" ON "WhatsappAccount"("workspaceId");

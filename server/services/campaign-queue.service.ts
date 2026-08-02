import { prisma } from '../lib/prisma';
import { renderTemplate } from './template-engine.service';
import { findOwnedCampaign } from './campaign.service';
import { emitCampaignProgress } from '../lib/campaign-events';
import { logAudit } from './whatsapp-audit.service';

export class CampaignQueueError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const DEFAULT_BATCH_SIZE = 1000;
const CLAIMABLE_STATUSES: ('PENDING' | 'WAITING' | 'RETRY')[] = ['PENDING', 'WAITING', 'RETRY'];

const requireConnectedAccount = async (userId: string) => {
  const account = await prisma.whatsappAccount.findUnique({ where: { userId } });
  if (!account || account.status !== 'CONNECTED') {
    throw new CampaignQueueError('Connect a WhatsApp account before sending campaigns', 400);
  }
  return account;
};

const requireReadyCampaign = async (workspaceId: string, campaignId: string) => {
  const campaign = await findOwnedCampaign(campaignId, workspaceId);
  if (campaign.status !== 'READY') {
    throw new CampaignQueueError('Campaign must be marked Ready before it can be sent', 400);
  }
  return campaign;
};

// One CampaignQueueJob per recipient, message pre-rendered via the Phase 3
// template engine (never re-implemented here) and snapshotted so later edits
// to a contact or the campaign message don't change what's already queued.
export const generateQueueJobs = async (campaignId: string): Promise<number> => {
  const existing = await prisma.campaignQueueJob.count({ where: { campaignId } });
  if (existing > 0) return existing;

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new CampaignQueueError('Campaign not found', 404);

  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId },
    include: { contact: true },
  });
  if (recipients.length === 0) throw new CampaignQueueError('Campaign has no recipients', 400);

  const account = await prisma.whatsappAccount.findUnique({ where: { userId: campaign.userId } });
  const maxAttempts = account?.maxRetries ?? 3;
  const batchSize = account?.batchSize ?? DEFAULT_BATCH_SIZE;

  // Blacklisted recipients still get a job row (for an accurate, auditable
  // recipient count) but are created already SKIPPED so the worker never
  // dispatches them - this is the Blacklist's actual enforcement point.
  const blacklist = await prisma.blacklistedNumber.findMany({
    where: { workspaceId: campaign.workspaceId },
    select: { phoneNumber: true, reason: true },
  });
  const blacklistMap = new Map(blacklist.map((b) => [b.phoneNumber, b.reason]));

  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);
    await prisma.campaignQueueJob.createMany({
      data: batch.map((r) => {
        const blockedReason = blacklistMap.get(r.contact.phoneNumber);
        return {
          campaignId,
          contactId: r.contactId,
          recipientPhone: r.contact.phoneNumber,
          recipientName: r.contact.name,
          renderedMessage: renderTemplate(campaign.messageText, r.contact),
          maxAttempts,
          status: blockedReason ? ('SKIPPED' as const) : undefined,
          errorMessage: blockedReason ? `Recipient is on your blacklist (${blockedReason})` : undefined,
        };
      }),
    });
  }
  return recipients.length;
};

export const startCampaignNow = async (workspaceId: string, userId: string, campaignId: string) => {
  await requireReadyCampaign(workspaceId, campaignId);
  await requireConnectedAccount(userId);
  await generateQueueJobs(campaignId);
  const updated = await prisma.campaign.update({
    where: { id: campaignId },
    data: { sendMode: 'NOW', sendStatus: 'SENDING', scheduledAt: null, queueStartedAt: new Date(), queuePausedAt: null },
  });
  emitCampaignProgress(campaignId);
  await logAudit(userId, 'CAMPAIGN_SEND_STARTED', campaignId);
  return updated;
};

export const scheduleCampaign = async (workspaceId: string, userId: string, campaignId: string, body: any) => {
  await requireReadyCampaign(workspaceId, campaignId);
  await requireConnectedAccount(userId);

  const scheduledAt = new Date(body?.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
    throw new CampaignQueueError('scheduledAt must be a valid future date/time', 400);
  }
  const timezone = typeof body?.timezone === 'string' && body.timezone.trim() ? body.timezone.trim().slice(0, 100) : 'UTC';

  await generateQueueJobs(campaignId);
  const updated = await prisma.campaign.update({
    where: { id: campaignId },
    data: { sendMode: 'SCHEDULED', sendStatus: 'SCHEDULED', scheduledAt, timezone, queuePausedAt: null, queueStartedAt: null },
  });
  emitCampaignProgress(campaignId);
  await logAudit(userId, 'CAMPAIGN_SCHEDULED', `${campaignId} at ${scheduledAt.toISOString()}`);
  return updated;
};

export const pauseCampaign = async (workspaceId: string, userId: string, campaignId: string) => {
  const campaign = await findOwnedCampaign(campaignId, workspaceId);
  if (campaign.sendStatus !== 'SENDING') {
    throw new CampaignQueueError('Only a currently sending campaign can be paused', 400);
  }
  const updated = await prisma.campaign.update({
    where: { id: campaignId },
    data: { sendStatus: 'PAUSED', queuePausedAt: new Date() },
  });
  emitCampaignProgress(campaignId);
  await logAudit(userId, 'CAMPAIGN_PAUSED', campaignId);
  return updated;
};

export const resumeCampaign = async (workspaceId: string, userId: string, campaignId: string) => {
  const campaign = await findOwnedCampaign(campaignId, workspaceId);
  if (campaign.sendStatus !== 'PAUSED') {
    throw new CampaignQueueError('Only a paused campaign can be resumed', 400);
  }
  const updated = await prisma.campaign.update({
    where: { id: campaignId },
    data: { sendStatus: 'SENDING', queuePausedAt: null },
  });
  emitCampaignProgress(campaignId);
  await logAudit(userId, 'CAMPAIGN_RESUMED', campaignId);
  return updated;
};

export const cancelQueue = async (workspaceId: string, userId: string, campaignId: string) => {
  const campaign = await findOwnedCampaign(campaignId, workspaceId);
  if (!['SENDING', 'PAUSED', 'SCHEDULED', 'QUEUED'].includes(campaign.sendStatus)) {
    throw new CampaignQueueError('Campaign is not currently queued or sending', 400);
  }
  await prisma.campaignQueueJob.updateMany({
    where: { campaignId, status: { in: CLAIMABLE_STATUSES } },
    data: { status: 'CANCELLED' },
  });
  const updated = await prisma.campaign.update({ where: { id: campaignId }, data: { sendStatus: 'CANCELLED' } });
  emitCampaignProgress(campaignId);
  await logAudit(userId, 'CAMPAIGN_CANCELLED', campaignId);
  return updated;
};

export const getCampaignProgress = async (workspaceId: string, campaignId: string) => {
  const campaign = await findOwnedCampaign(campaignId, workspaceId);

  const [statusGroups, deliveryGroups, total] = await Promise.all([
    prisma.campaignQueueJob.groupBy({ by: ['status'], where: { campaignId }, _count: true }),
    prisma.campaignQueueJob.groupBy({ by: ['deliveryStatus'], where: { campaignId }, _count: true }),
    prisma.campaignQueueJob.count({ where: { campaignId } }),
  ]);

  const counts: Record<string, number> = { PENDING: 0, WAITING: 0, SENDING: 0, SENT: 0, FAILED: 0, RETRY: 0, CANCELLED: 0, SKIPPED: 0 };
  statusGroups.forEach((g: any) => { counts[g.status] = g._count; });

  const delivery: Record<string, number> = { UNKNOWN: 0, SENT: 0, DELIVERED: 0, READ: 0, FAILED: 0 };
  deliveryGroups.forEach((g: any) => { delivery[g.deliveryStatus] = g._count; });

  const terminal = counts.SENT + counts.FAILED + counts.CANCELLED + counts.SKIPPED;
  const remaining = total - terminal;
  const percentage = total > 0 ? Math.round((terminal / total) * 100) : 0;

  let elapsedMs: number | null = null;
  let etaSeconds: number | null = null;
  let messagesPerMinute: number | null = null;
  if (campaign.queueStartedAt) {
    elapsedMs = Date.now() - campaign.queueStartedAt.getTime();
    const recentWindowMs = 5 * 60 * 1000;
    const recentCompleted = await prisma.campaignQueueJob.count({
      where: { campaignId, completedAt: { gte: new Date(Date.now() - recentWindowMs) } },
    });
    const minutesElapsed = Math.min(elapsedMs, recentWindowMs) / 60000;
    messagesPerMinute = minutesElapsed > 0 ? recentCompleted / minutesElapsed : null;
    if (messagesPerMinute && messagesPerMinute > 0 && remaining > 0) {
      etaSeconds = Math.round((remaining / messagesPerMinute) * 60);
    }
  }

  return {
    campaignId,
    sendStatus: campaign.sendStatus,
    total,
    counts,
    delivery,
    percentage,
    remaining,
    elapsedMs,
    etaSeconds,
    messagesPerMinute: messagesPerMinute ? Math.round(messagesPerMinute * 10) / 10 : null,
    queueStartedAt: campaign.queueStartedAt,
    queueCompletedAt: campaign.queueCompletedAt,
    scheduledAt: campaign.scheduledAt,
  };
};

export interface CampaignLogsOptions {
  page?: number;
  pageSize?: number;
}

export const getCampaignLogs = async (workspaceId: string, campaignId: string, options: CampaignLogsOptions) => {
  await findOwnedCampaign(campaignId, workspaceId);
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 25));

  const [logs, total] = await Promise.all([
    prisma.campaignSendLog.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.campaignSendLog.count({ where: { campaignId } }),
  ]);

  return { logs, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

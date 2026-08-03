import { prisma } from '../lib/prisma';
import { toPublicAccount } from './whatsapp-account.service';
import { requiresAutoPause } from './meta-validation.service';
import { getDailyLimitSnapshot } from './daily-limit-engine.service';
import { getRateLimitSnapshot } from '../lib/rate-limit-manager';
import { getWebhookHealthBatch } from './webhook-health.service';
import { previewRouting } from './account-routing.service';
import { getSchedulerRegistry } from '../lib/scheduler-registry';

export class OperationsError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// Phase B.5 - Operations Engine. A thin composition layer only: every number
// here is produced by an existing, single-purpose module (routing, daily
// limits, rate limiting, webhook health, quality, scheduler registry) - this
// file never recomputes any of that logic itself, it just assembles their
// outputs into the shapes the new API/dashboard endpoints need. That is the
// entire point of "no duplicated logic" for a centralized operations layer.

const requireOwnAccount = async (userId: string) => {
  const account = await prisma.whatsappAccount.findUnique({ where: { userId } });
  if (!account) throw new OperationsError('No WhatsApp account is connected', 404);
  return account;
};

// GET /account/operations - full self-service operational snapshot.
export const getAccountOperations = async (userId: string) => {
  const account = await requireOwnAccount(userId);
  const webhookHealthMap = await getWebhookHealthBatch([account]);

  return {
    account: toPublicAccount(account),
    reconnectRequired: requiresAutoPause(account.tokenStatus as any),
    sendingEnabled: account.sendingEnabled,
    sendingDisabledReason: account.sendingDisabledReason,
    dailyLimit: getDailyLimitSnapshot(account),
    rateLimit: getRateLimitSnapshot(account.id, account.rateLimitPerMinute),
    quality: {
      qualityRating: account.qualityRating,
      healthStatus: account.healthStatus,
      messagingLimitTier: account.messagingLimitTier,
      lastSyncAt: account.lastSyncAt,
    },
    webhookHealth: webhookHealthMap.get(account.id) ?? null,
    lastFailoverAt: account.lastFailoverAt,
    lastFailoverReason: account.lastFailoverReason,
  };
};

// GET /account/limits
export const getAccountLimits = async (userId: string) => {
  const account = await requireOwnAccount(userId);
  return {
    dailyLimit: getDailyLimitSnapshot(account),
    rateLimit: getRateLimitSnapshot(account.id, account.rateLimitPerMinute),
  };
};

// GET /account/quality
export const getAccountQuality = async (userId: string) => {
  const account = await requireOwnAccount(userId);
  return {
    qualityRating: account.qualityRating,
    healthStatus: account.healthStatus,
    messagingLimitTier: account.messagingLimitTier,
    verifiedName: account.verifiedName,
    connectionHealth: account.connectionHealth,
    lastSyncAt: account.lastSyncAt,
    sendingEnabled: account.sendingEnabled,
    sendingDisabledReason: account.sendingDisabledReason,
  };
};

// GET /account/routing - workspace-wide routing preview (not self-only,
// since routing decisions are made at the workspace level).
export const getAccountRouting = async (workspaceId: string) => previewRouting(workspaceId);

const UPCOMING_EXPIRY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// GET /dashboard/operations - workspace-wide aggregate, extending the
// existing WhatsApp dashboard (whatsapp-dashboard.service.ts's getDashboard)
// with an additive second call rather than folding into that function -
// keeps the original dashboard payload's shape/cost unchanged for any
// existing caller, per the brief's "extend, don't redesign."
export const getDashboardOperations = async (workspaceId: string) => {
  const accounts = await prisma.whatsappAccount.findMany({ where: { workspaceId } });
  const now = new Date();

  const connectedAccounts = accounts.filter((a) => a.status === 'CONNECTED').length;
  const healthyAccounts = accounts.filter((a) => a.status === 'CONNECTED' && a.healthStatus === 'HEALTHY').length;
  const upcomingExpiry = accounts
    .filter((a) => a.tokenExpiresAt && a.tokenExpiresAt.getTime() - now.getTime() < UPCOMING_EXPIRY_WINDOW_MS)
    .map((a) => ({ accountId: a.id, businessName: a.businessName, tokenExpiresAt: a.tokenExpiresAt }));

  const accountIds = accounts.map((a) => a.id);
  const campaigns = await prisma.campaign.findMany({
    where: { workspaceId, whatsappAccountId: { in: accountIds } },
    select: { id: true, whatsappAccountId: true, sendStatus: true },
  });
  const campaignIds = campaigns.map((c) => c.id);

  const [queueSizeGroups, todaySendGroups, webhookHealthMap] = await Promise.all([
    campaignIds.length > 0
      ? prisma.campaignQueueJob.groupBy({
          by: ['campaignId'],
          where: { campaignId: { in: campaignIds }, status: { in: ['PENDING', 'WAITING', 'SENDING', 'RETRY'] } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    campaignIds.length > 0
      ? prisma.campaignSendLog.groupBy({
          by: ['campaignId', 'status'],
          where: { campaignId: { in: campaignIds }, createdAt: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    getWebhookHealthBatch(accounts),
  ]);

  const accountIdByCampaignId = new Map(campaigns.map((c) => [c.id, c.whatsappAccountId as string]));
  const queueSizeByAccount = new Map<string, number>();
  for (const row of queueSizeGroups) {
    const accountId = accountIdByCampaignId.get(row.campaignId);
    if (!accountId) continue;
    queueSizeByAccount.set(accountId, (queueSizeByAccount.get(accountId) ?? 0) + row._count._all);
  }
  let todaySends = 0;
  let todayFailures = 0;
  const distributionByAccount = new Map<string, number>();
  for (const c of campaigns) {
    if (c.sendStatus === 'SENDING' || c.sendStatus === 'SCHEDULED' || c.sendStatus === 'QUEUED') {
      const accountId = c.whatsappAccountId as string;
      distributionByAccount.set(accountId, (distributionByAccount.get(accountId) ?? 0) + 1);
    }
  }
  for (const row of todaySendGroups) {
    if (row.status === 'SENT') todaySends += row._count._all;
    if (row.status === 'FAILED') todayFailures += row._count._all;
  }

  const queueSize = [...queueSizeByAccount.values()].reduce((a, b) => a + b, 0);

  const webhookByLevel = { HEALTHY: 0, WARNING: 0, CRITICAL: 0, UNKNOWN: 0 };
  for (const stats of webhookHealthMap.values()) {
    webhookByLevel[stats.healthStatus] += 1;
  }

  return {
    connectedAccounts,
    healthyAccounts,
    totalAccounts: accounts.length,
    queueSize,
    todaySends,
    todayFailures,
    dailyUsage: accounts
      .filter((a) => a.status === 'CONNECTED')
      .map((a) => ({ accountId: a.id, businessName: a.businessName, ...getDailyLimitSnapshot(a) })),
    rateLimit: accounts
      .filter((a) => a.status === 'CONNECTED')
      .map((a) => ({ accountId: a.id, businessName: a.businessName, ...getRateLimitSnapshot(a.id, a.rateLimitPerMinute) })),
    quality: accounts
      .filter((a) => a.status === 'CONNECTED')
      .map((a) => ({ accountId: a.id, businessName: a.businessName, qualityRating: a.qualityRating, healthStatus: a.healthStatus, messagingLimitTier: a.messagingLimitTier })),
    webhook: webhookByLevel,
    upcomingExpiry,
    campaignDistribution: accounts.map((a) => ({ accountId: a.id, businessName: a.businessName, activeCampaigns: distributionByAccount.get(a.id) ?? 0 })),
    schedulers: getSchedulerRegistry(),
  };
};

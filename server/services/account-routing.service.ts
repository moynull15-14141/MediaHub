import type { WhatsappAccount } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requiresAutoPause } from './meta-validation.service';
import { isWithinDailyLimit } from './daily-limit-engine.service';

// Phase B.5 - Smart Routing. Replaces the "simple account selection" every
// pre-B.5 caller used (campaign-queue.service.ts's old resolveAccountForCampaign:
// explicit whatsappAccountId, else the owner's own account, full stop) with
// the brief's priority chain:
//   Explicit Campaign Account -> Healthy Default Account -> Highest Priority
//   -> Lowest Queue -> Best Quality Rating -> Stop if none available
// Workspace-isolated throughout: every candidate pool is scoped to exactly
// one workspaceId, so routing can never pick an account belonging to a
// different tenant.

const ACTIVE_QUEUE_STATUSES = ['PENDING', 'WAITING', 'SENDING', 'RETRY'] as const;

// "Usable" = could take a new send right now. requiresAutoPause mirrors the
// exact same token-status set the health scheduler already auto-pauses on
// (RECONNECT_REQUIRED/INVALID/PERMISSION_REVOKED) - one definition of
// "this account's token is broken," not a second one.
const isUsable = (account: WhatsappAccount, now: Date): boolean => {
  if (account.status !== 'CONNECTED') return false;
  if (!account.sendingEnabled) return false;
  if (requiresAutoPause(account.tokenStatus as any)) return false;
  if (!isWithinDailyLimit(account, now)) return false;
  return true;
};

const QUALITY_RANK: Record<string, number> = { HEALTHY: 3, WARNING: 2, UNKNOWN: 1, UNHEALTHY: 0 };

// Ranks already-usable candidates: Healthy Default Account first (isDefault,
// and only usable accounts reach this point so "default" here already means
// "healthy default"), then Highest Priority, then Lowest Queue, then Best
// Quality Rating - exactly the brief's chain, applied as successive
// tie-breakers rather than separate passes.
const rankCandidates = (candidates: WhatsappAccount[], queueDepthByAccount: Map<string, number>): WhatsappAccount[] =>
  [...candidates].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    const qa = queueDepthByAccount.get(a.id) ?? 0;
    const qb = queueDepthByAccount.get(b.id) ?? 0;
    if (qa !== qb) return qa - qb;
    return (QUALITY_RANK[b.healthStatus] ?? 0) - (QUALITY_RANK[a.healthStatus] ?? 0);
  });

const getQueueDepthByAccount = async (accountIds: string[]): Promise<Map<string, number>> => {
  if (accountIds.length === 0) return new Map();
  const campaigns = await prisma.campaign.findMany({
    where: { whatsappAccountId: { in: accountIds }, sendStatus: { in: ['SENDING', 'SCHEDULED', 'QUEUED'] } },
    select: { id: true, whatsappAccountId: true },
  });
  if (campaigns.length === 0) return new Map();
  const accountIdByCampaignId = new Map(campaigns.map((c) => [c.id, c.whatsappAccountId as string]));
  const counts = await prisma.campaignQueueJob.groupBy({
    by: ['campaignId'],
    where: { campaignId: { in: [...accountIdByCampaignId.keys()] }, status: { in: [...ACTIVE_QUEUE_STATUSES] } },
    _count: { _all: true },
  });
  const result = new Map<string, number>();
  for (const row of counts) {
    const accountId = accountIdByCampaignId.get(row.campaignId);
    if (!accountId) continue;
    result.set(accountId, (result.get(accountId) ?? 0) + row._count._all);
  }
  return result;
};

// Steps 2-5 of the chain, usable standalone by the Failover Engine (which
// always excludes the account that just failed) as well as by
// resolveSendingAccountsBatch below when the explicit/legacy account isn't
// usable.
export const pickHealthyAccountInWorkspace = async (workspaceId: string, excludeAccountId?: string): Promise<WhatsappAccount | null> => {
  const accounts = await prisma.whatsappAccount.findMany({
    where: { workspaceId, ...(excludeAccountId ? { id: { not: excludeAccountId } } : {}) },
  });
  const now = new Date();
  const usable = accounts.filter((a) => isUsable(a, now));
  if (usable.length === 0) return null;
  const queueDepth = await getQueueDepthByAccount(usable.map((a) => a.id));
  return rankCandidates(usable, queueDepth)[0] ?? null;
};

export interface RoutingCampaignInput {
  id: string;
  whatsappAccountId: string | null;
  userId: string;
  workspaceId: string;
}

export type RoutingReason = 'EXPLICIT' | 'FALLBACK' | 'NONE_AVAILABLE';

export interface RoutingResult {
  account: WhatsappAccount | null;
  reason: RoutingReason;
}

// Batched: one query set per distinct workspace involved, regardless of how
// many campaigns are passed in - the hot dispatch loop's original
// duplicate-avoidance concern (see campaign-queue-worker.service.ts's prior
// inline resolveLegacyAccountId) is why this exists as a batch entry point
// rather than resolveSendingAccount looping N times.
export const resolveSendingAccountsBatch = async (campaigns: RoutingCampaignInput[]): Promise<Map<string, RoutingResult>> => {
  const result = new Map<string, RoutingResult>();
  if (campaigns.length === 0) return result;

  const workspaceIds = [...new Set(campaigns.map((c) => c.workspaceId))];
  const accountsByWorkspace = new Map<string, WhatsappAccount[]>();
  const allAccounts = await prisma.whatsappAccount.findMany({ where: { workspaceId: { in: workspaceIds } } });
  for (const account of allAccounts) {
    const list = accountsByWorkspace.get(account.workspaceId) ?? [];
    list.push(account);
    accountsByWorkspace.set(account.workspaceId, list);
  }

  const now = new Date();
  const usableAccountIds = allAccounts.filter((a) => isUsable(a, now)).map((a) => a.id);
  const queueDepth = await getQueueDepthByAccount(usableAccountIds);

  for (const campaign of campaigns) {
    const workspaceAccounts = accountsByWorkspace.get(campaign.workspaceId) ?? [];
    const byId = new Map(workspaceAccounts.map((a) => [a.id, a]));
    const byUserId = new Map(workspaceAccounts.map((a) => [a.userId, a]));

    // Step 1: Explicit Campaign Account.
    if (campaign.whatsappAccountId) {
      const explicit = byId.get(campaign.whatsappAccountId);
      if (explicit && isUsable(explicit, now)) {
        result.set(campaign.id, { account: explicit, reason: 'EXPLICIT' });
        continue;
      }
    } else {
      // Legacy fallback (campaigns created before whatsappAccountId
      // existed): the owner's own account counts as "explicit" too.
      const legacy = byUserId.get(campaign.userId);
      if (legacy && isUsable(legacy, now)) {
        result.set(campaign.id, { account: legacy, reason: 'EXPLICIT' });
        continue;
      }
    }

    // Steps 2-5: Healthy Default -> Highest Priority -> Lowest Queue -> Best
    // Quality, excluding the explicit account (it was just checked and
    // rejected as unusable, so it can never be re-picked as its own
    // fallback).
    const usable = workspaceAccounts.filter((a) => isUsable(a, now) && a.id !== campaign.whatsappAccountId);
    if (usable.length === 0) {
      result.set(campaign.id, { account: null, reason: 'NONE_AVAILABLE' });
      continue;
    }
    const ranked = rankCandidates(usable, queueDepth);
    result.set(campaign.id, { account: ranked[0] ?? null, reason: 'FALLBACK' });
  }

  return result;
};

export const resolveSendingAccount = async (campaign: RoutingCampaignInput): Promise<RoutingResult> => {
  const batch = await resolveSendingAccountsBatch([campaign]);
  return batch.get(campaign.id) ?? { account: null, reason: 'NONE_AVAILABLE' };
};

export interface RoutingPreviewEntry {
  accountId: string;
  businessName: string | null;
  displayPhoneNumber: string | null;
  usable: boolean;
  isDefault: boolean;
  priority: number;
  queueDepth: number;
  qualityRank: number;
  rank: number | null;
}

// GET /account/routing - shows the workspace's current routing chain, for
// operators to understand (or debug) why a given account would or wouldn't
// be chosen next.
export const previewRouting = async (workspaceId: string): Promise<RoutingPreviewEntry[]> => {
  const accounts = await prisma.whatsappAccount.findMany({ where: { workspaceId } });
  const now = new Date();
  const usableAccounts = accounts.filter((a) => isUsable(a, now));
  const queueDepth = await getQueueDepthByAccount(usableAccounts.map((a) => a.id));
  const ranked = rankCandidates(usableAccounts, queueDepth);
  const rankById = new Map(ranked.map((a, i) => [a.id, i + 1]));

  return accounts
    .map((account) => ({
      accountId: account.id,
      businessName: account.businessName,
      displayPhoneNumber: account.displayPhoneNumber,
      usable: isUsable(account, now),
      isDefault: account.isDefault,
      priority: account.priority,
      queueDepth: queueDepth.get(account.id) ?? 0,
      qualityRank: QUALITY_RANK[account.healthStatus] ?? 0,
      rank: rankById.get(account.id) ?? null,
    }))
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
};

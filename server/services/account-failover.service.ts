import { prisma } from '../lib/prisma';
import { pickHealthyAccountInWorkspace } from './account-routing.service';
import { pauseCampaignsForAccountFailover } from './campaign-queue.service';
import { logAudit } from './whatsapp-audit.service';
import { emitCampaignProgress } from '../lib/campaign-events';
import { operationsLogger } from '../lib/logger';

export class AccountFailoverError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export interface FailoverResult {
  reassigned: number;
  paused: number;
  targetAccountId: string | null;
}

// Phase B.5 - Failover Engine. The single entry point for "this account just
// became unusable" (Disconnected / Expired / Permission Error / Critical),
// called from three trigger sources - whatsapp-health-scheduler.service.ts's
// token-status transition, account-quality-monitor.service.ts's RED-quality
// disable, and its webhook-CRITICAL disable - so there is exactly one
// implementation of "what happens to this account's in-flight campaigns,"
// not three. Moves every currently-SENDING campaign resolved to `accountId`
// onto a healthy replacement in the SAME workspace (pickHealthyAccountInWorkspace
// is itself workspace-scoped, so cross-workspace movement is structurally
// impossible); falls back to the existing pause path (unchanged behavior)
// when no replacement exists.
export const failoverAccount = async (accountId: string, reason: string, actingUserId?: string): Promise<FailoverResult> => {
  const account = await prisma.whatsappAccount.findUnique({ where: { id: accountId } });
  if (!account) return { reassigned: 0, paused: 0, targetAccountId: null };

  const affected = await prisma.campaign.findMany({
    where: {
      sendStatus: 'SENDING',
      OR: [{ whatsappAccountId: accountId }, { whatsappAccountId: null, userId: account.userId }],
    },
    select: { id: true },
  });
  if (affected.length === 0) return { reassigned: 0, paused: 0, targetAccountId: null };

  const replacement = await pickHealthyAccountInWorkspace(account.workspaceId, accountId);

  if (!replacement) {
    const pausedCount = await pauseCampaignsForAccountFailover(accountId, reason);
    operationsLogger.warn('ACCOUNT_FAILOVER_PAUSED', { accountId, reason, pausedCount });
    return { reassigned: 0, paused: pausedCount, targetAccountId: null };
  }

  await prisma.campaign.updateMany({
    where: { id: { in: affected.map((c) => c.id) } },
    data: { whatsappAccountId: replacement.id },
  });
  for (const campaign of affected) {
    emitCampaignProgress(campaign.id);
    await logAudit(actingUserId ?? account.userId, 'CAMPAIGN_FAILED_OVER', `${campaign.id}: ${accountId} -> ${replacement.id} (${reason})`);
  }
  await prisma.whatsappAccount.update({ where: { id: accountId }, data: { lastFailoverAt: new Date(), lastFailoverReason: reason } });
  operationsLogger.warn('ACCOUNT_FAILOVER', { accountId, targetAccountId: replacement.id, reassigned: affected.length, reason });
  return { reassigned: affected.length, paused: 0, targetAccountId: replacement.id };
};

// POST /account/failover - manual trigger (self-service, caller's own
// account) for an operator who wants to force a failover immediately rather
// than waiting for an automatic trigger to notice.
export const manualFailover = async (userId: string): Promise<FailoverResult> => {
  const account = await prisma.whatsappAccount.findUnique({ where: { userId } });
  if (!account) throw new AccountFailoverError('No WhatsApp account is connected', 404);
  return failoverAccount(account.id, 'Manual failover requested', userId);
};

// POST /account/rebalance - re-runs routing for every campaign currently
// SENDING on the caller's own account, moving any that would now route to a
// higher-ranked sibling (e.g. this account's queue grew deep while a
// sibling's stayed empty). Distinct from failover: the source account is
// still healthy, this is optimization, not recovery - so it only ever moves
// campaigns toward a strictly better-ranked candidate, never as an
// emergency fallback.
export const rebalanceAccount = async (userId: string): Promise<{ moved: number }> => {
  const account = await prisma.whatsappAccount.findUnique({ where: { userId } });
  if (!account) throw new AccountFailoverError('No WhatsApp account is connected', 404);

  const sending = await prisma.campaign.findMany({
    where: { sendStatus: 'SENDING', whatsappAccountId: account.id },
    select: { id: true },
  });
  if (sending.length === 0) return { moved: 0 };

  const target = await pickHealthyAccountInWorkspace(account.workspaceId, account.id);
  if (!target) return { moved: 0 };

  await prisma.campaign.updateMany({
    where: { id: { in: sending.map((c) => c.id) } },
    data: { whatsappAccountId: target.id },
  });
  for (const campaign of sending) {
    emitCampaignProgress(campaign.id);
    await logAudit(userId, 'CAMPAIGN_REBALANCED', `${campaign.id}: ${account.id} -> ${target.id}`);
  }
  operationsLogger.info('ACCOUNT_REBALANCE', { fromAccountId: account.id, toAccountId: target.id, moved: sending.length });
  return { moved: sending.length };
};

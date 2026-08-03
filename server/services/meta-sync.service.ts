import { prisma } from '../lib/prisma';
import { config } from '../lib/config';
import { decryptToken } from '../lib/whatsapp-crypto';
import { fetchPhoneNumberDetails, fetchWabaDetails, fetchBusinessDetails, debugToken, WhatsappGraphError } from '../lib/whatsapp-graph';
import { toPublicAccount, qualityToHealth, WhatsappAccountError } from './whatsapp-account.service';
import { logAudit } from './whatsapp-audit.service';
import { getWebhookHealthBatch } from './webhook-health.service';

// Shared by both the Embedded Signup completion (meta-signup.service.ts,
// fetching for the first time) and this file's syncAccount (re-fetching an
// already-connected account) - one implementation of "what does Meta say
// about this phone number/WABA/business right now" instead of two.
export const fetchLiveAccountData = async (
  phoneNumberId: string,
  wabaId: string | null,
  businessId: string | null,
  accessToken: string,
) => {
  const [phoneDetails, wabaDetails, tokenInfo] = await Promise.all([
    fetchPhoneNumberDetails(phoneNumberId, accessToken),
    wabaId ? fetchWabaDetails(wabaId, accessToken).catch(() => null) : Promise.resolve(null),
    debugToken(accessToken, config.meta.appId, config.meta.appSecret).catch(() => null),
  ]);
  const businessDetails = businessId ? await fetchBusinessDetails(businessId, accessToken).catch(() => null) : null;
  return { phoneDetails, wabaDetails, businessDetails, tokenInfo };
};

// Part 10 "Sync" action + Part 6 "Auto Sync". Source-agnostic: works the
// same for a manually-connected account (no wabaId/businessId - just
// re-fetches phone details, same as the pre-existing /account/refresh) and a
// Meta-connected one (also re-fetches WABA/business info + token
// introspection), so it is a strict superset, not a competing code path.
export const syncAccount = async (workspaceId: string, userId: string) => {
  const account = await prisma.whatsappAccount.findUnique({ where: { userId } });
  if (!account) throw new WhatsappAccountError('No WhatsApp account is connected', 404);
  if (account.workspaceId !== workspaceId) throw new WhatsappAccountError('This account does not belong to your workspace', 403);

  try {
    const accessToken = decryptToken(account.accessTokenEncrypted);
    const { phoneDetails, wabaDetails, businessDetails, tokenInfo } = await fetchLiveAccountData(
      account.phoneNumberId,
      account.wabaId,
      account.metaBusinessId,
      accessToken,
    );

    const now = new Date();
    const updated = await prisma.whatsappAccount.update({
      where: { userId },
      data: {
        displayPhoneNumber: phoneDetails.displayPhoneNumber,
        verifiedName: phoneDetails.verifiedName,
        businessName: businessDetails?.name || wabaDetails?.name || account.businessName,
        qualityRating: phoneDetails.qualityRating,
        messagingLimitTier: phoneDetails.messagingLimitTier,
        healthStatus: qualityToHealth(phoneDetails.qualityRating),
        accountReviewStatus: wabaDetails?.accountReviewStatus ?? account.accountReviewStatus,
        businessVerificationStatus: businessDetails?.verificationStatus ?? account.businessVerificationStatus,
        metaBusinessName: businessDetails?.name ?? account.metaBusinessName,
        grantedScopes: tokenInfo?.scopes?.length ? tokenInfo.scopes.join(',') : account.grantedScopes,
        status: 'CONNECTED',
        connectionHealth: tokenInfo && !tokenInfo.isValid ? 'PERMISSION_ERROR' : 'CONNECTED',
        lastErrorMessage: null,
        lastSyncAt: now,
      },
    });
    await logAudit(userId, 'ACCOUNT_SYNCED', account.phoneNumberId);
    return toPublicAccount(updated);
  } catch (err) {
    const message = err instanceof WhatsappGraphError ? err.message : 'Failed to sync account';
    const updated = await prisma.whatsappAccount.update({
      where: { userId },
      data: {
        status: 'ERROR',
        connectionHealth: err instanceof WhatsappGraphError && err.status === 401 ? 'EXPIRED' : 'DISCONNECTED',
        lastErrorMessage: message,
        lastSyncAt: new Date(),
      },
    });
    return toPublicAccount(updated);
  }
};

const ACTIVE_QUEUE_STATUSES = ['PENDING', 'WAITING', 'SENDING', 'RETRY'] as const;

// Phase B.2 - "current queue" stat on the Accounts dashboard: how many
// not-yet-terminal job rows are currently resolved to send from each
// account. Computed here (not stored on WhatsappAccount) since it's a live
// count, not a column - kept out of toPublicAccount so that function's
// contract stays "exactly the DB row's public fields."
const getPendingJobCountsByAccountId = async (
  workspaceId: string,
  accounts: { id: string; userId: string }[],
): Promise<Map<string, number>> => {
  const campaigns = await prisma.campaign.findMany({
    where: { workspaceId, sendStatus: { in: ['SENDING', 'SCHEDULED', 'QUEUED'] } },
    select: { id: true, userId: true, whatsappAccountId: true },
  });
  if (campaigns.length === 0) return new Map();

  const accountIdByUserId = new Map(accounts.map((a) => [a.userId, a.id]));
  const accountIdByCampaignId = new Map<string, string>();
  for (const campaign of campaigns) {
    const accountId = campaign.whatsappAccountId ?? accountIdByUserId.get(campaign.userId);
    if (accountId) accountIdByCampaignId.set(campaign.id, accountId);
  }

  const counts = await prisma.campaignQueueJob.groupBy({
    by: ['campaignId'],
    where: { campaignId: { in: [...accountIdByCampaignId.keys()] }, status: { in: [...ACTIVE_QUEUE_STATUSES] } },
    _count: true,
  });

  const result = new Map<string, number>();
  for (const row of counts as any[]) {
    const accountId = accountIdByCampaignId.get(row.campaignId);
    if (!accountId) continue;
    result.set(accountId, (result.get(accountId) ?? 0) + row._count);
  }
  return result;
};

// Part 7/10: every account connected within the workspace (one row per
// member who has connected their own number), not just the requesting
// user's own row - this is what makes the Accounts page reflect "one
// workspace, many WhatsApp accounts" instead of a single-account view.
export const listWorkspaceAccounts = async (workspaceId: string) => {
  const accounts = await prisma.whatsappAccount.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'asc' },
  });
  const [pendingCounts, webhookHealth] = await Promise.all([
    getPendingJobCountsByAccountId(workspaceId, accounts),
    // Phase B.4 - live webhook stats (events today/hour, avg processing
    // time, retries, dead letters, failure rate) merged in for every account
    // in the workspace, not just the caller's own - same "computed live,
    // batched, no N+1" treatment as pendingJobCount above.
    getWebhookHealthBatch(accounts),
  ]);
  return accounts.map((a) => ({
    ...toPublicAccount(a),
    pendingJobCount: pendingCounts.get(a.id) ?? 0,
    webhookHealth: webhookHealth.get(a.id) ?? null,
  }));
};

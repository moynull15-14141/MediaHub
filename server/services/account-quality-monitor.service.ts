import type { WhatsappAccount } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { decryptToken } from '../lib/whatsapp-crypto';
import { fetchPhoneNumberDetails } from '../lib/whatsapp-graph';
import { qualityToHealth } from './whatsapp-account.service';
import { failoverAccount } from './account-failover.service';
import { logAudit } from './whatsapp-audit.service';
import { sendMail } from '../lib/email';
import { getWorkspaceOwnerEmails } from './workspace.service';
import { operationsLogger } from '../lib/logger';
import type { WebhookHealthLevel } from './webhook-health.service';

// Both monitors below can run within the same 30-min tick (quality RED and
// webhook CRITICAL are independent conditions that can both be true at
// once) - re-reading these two fields fresh immediately before acting
// avoids one monitor clobbering the other's sendingDisabledReason with a
// stale in-memory read of the account object passed into the batch loop.
const getFreshSendingState = async (accountId: string): Promise<{ sendingEnabled: boolean; sendingDisabledReason: string | null }> => {
  const fresh = await prisma.whatsappAccount.findUnique({ where: { id: accountId }, select: { sendingEnabled: true, sendingDisabledReason: true } });
  return fresh ?? { sendingEnabled: false, sendingDisabledReason: null };
};

const notifyOwner = async (account: WhatsappAccount, reason: string): Promise<void> => {
  if (!account.notifyEmail) return;
  const owners = await getWorkspaceOwnerEmails(account.workspaceId);
  if (owners.length === 0) return;
  const label = account.businessName || account.displayPhoneNumber || account.phoneNumberId;
  await sendMail({
    to: owners,
    subject: `WhatsApp account sending disabled - ${label}`,
    text: [
      `Business: ${label}`,
      `Phone: ${account.displayPhoneNumber || account.phoneNumberId}`,
      `Reason: ${reason}`,
      `Open the Accounts page to review and resolve.`,
      `Time detected: ${new Date().toISOString()}`,
    ].join('\n'),
  });
};

// Phase B.5 - Phone Quality Monitor. Syncs quality/tier from Meta the same
// way refreshConnection/syncAccount (whatsapp-account.service.ts/
// meta-sync.service.ts) already do - fetchPhoneNumberDetails + qualityToHealth,
// unchanged logic - this just does it PROACTIVELY on the existing 30-min
// health-scheduler cadence instead of only on a user-triggered sync, and
// reacts to the result: RED quality disables sending (its own, distinct
// reason from a token/connection failure) and hands any in-flight campaigns
// to the Failover Engine rather than reimplementing "move to another
// account" here.
export const syncAndMonitorQuality = async (account: WhatsappAccount): Promise<void> => {
  if (account.status !== 'CONNECTED') return;

  let details;
  try {
    const accessToken = decryptToken(account.accessTokenEncrypted);
    details = await fetchPhoneNumberDetails(account.phoneNumberId, accessToken);
  } catch {
    // Token/network trouble is meta-validation.service.ts's job to classify
    // in this same tick - skip rather than duplicating that error handling.
    return;
  }

  const now = new Date();
  const nextHealth = qualityToHealth(details.qualityRating);
  const previousQuality = account.qualityRating;

  await prisma.whatsappAccount.update({
    where: { id: account.id },
    data: { qualityRating: details.qualityRating, messagingLimitTier: details.messagingLimitTier, healthStatus: nextHealth, lastSyncAt: now },
  });
  account.qualityRating = details.qualityRating;
  account.messagingLimitTier = details.messagingLimitTier;
  account.healthStatus = nextHealth;

  if (previousQuality && details.qualityRating && previousQuality !== details.qualityRating) {
    await logAudit(account.userId, 'QUALITY_RATING_CHANGED', `${previousQuality} -> ${details.qualityRating}`);
  }

  const sendingState = await getFreshSendingState(account.id);
  if (nextHealth === 'UNHEALTHY' && sendingState.sendingEnabled) {
    await prisma.whatsappAccount.update({ where: { id: account.id }, data: { sendingEnabled: false, sendingDisabledReason: 'QUALITY_RED' } });
    const { reassigned, paused } = await failoverAccount(account.id, 'Phone quality dropped to RED', account.userId);
    await logAudit(account.userId, 'ACCOUNT_SENDING_DISABLED_QUALITY', `reassigned ${reassigned}, paused ${paused} campaign(s)`);
    operationsLogger.warn('QUALITY_DISABLE', { accountId: account.id, reassigned, paused });
    await notifyOwner(account, 'Phone number quality dropped to RED - sending has been automatically disabled.');
  } else if (nextHealth !== 'UNHEALTHY' && sendingState.sendingDisabledReason === 'QUALITY_RED') {
    await prisma.whatsappAccount.update({ where: { id: account.id }, data: { sendingEnabled: true, sendingDisabledReason: null } });
    await logAudit(account.userId, 'ACCOUNT_SENDING_RECOVERED_QUALITY', `quality now ${nextHealth}`);
    operationsLogger.info('QUALITY_RECOVERED', { accountId: account.id, health: nextHealth });
  }
};

// Phase B.5 - the "Critical" trigger in the Failover Engine section, sourced
// from Phase B.4's webhookHealthStatus. Takes the freshly computed level as
// a parameter (rather than re-reading account.webhookHealthStatus) because
// it must run strictly after webhook-health.service.ts's
// checkAndAlertWebhookHealth persists that same tick's result - reading a
// stale in-memory `account.webhookHealthStatus` here could still reflect
// the PREVIOUS tick's classification.
export const monitorWebhookCriticalDisable = async (account: WhatsappAccount, webhookHealthStatus: WebhookHealthLevel): Promise<void> => {
  if (account.status !== 'CONNECTED') return;

  const sendingState = await getFreshSendingState(account.id);
  if (webhookHealthStatus === 'CRITICAL' && sendingState.sendingEnabled) {
    await prisma.whatsappAccount.update({ where: { id: account.id }, data: { sendingEnabled: false, sendingDisabledReason: 'WEBHOOK_CRITICAL' } });
    const { reassigned, paused } = await failoverAccount(account.id, 'Webhook health is CRITICAL', account.userId);
    await logAudit(account.userId, 'ACCOUNT_SENDING_DISABLED_WEBHOOK', `reassigned ${reassigned}, paused ${paused} campaign(s)`);
    operationsLogger.warn('WEBHOOK_CRITICAL_DISABLE', { accountId: account.id, reassigned, paused });
    await notifyOwner(account, 'Webhook health is CRITICAL - sending has been automatically disabled.');
  } else if (webhookHealthStatus !== 'CRITICAL' && sendingState.sendingDisabledReason === 'WEBHOOK_CRITICAL') {
    await prisma.whatsappAccount.update({ where: { id: account.id }, data: { sendingEnabled: true, sendingDisabledReason: null } });
    await logAudit(account.userId, 'ACCOUNT_SENDING_RECOVERED_WEBHOOK', `webhook health now ${webhookHealthStatus}`);
    operationsLogger.info('WEBHOOK_CRITICAL_RECOVERED', { accountId: account.id, webhookHealthStatus });
  }
};

import type { WhatsappAccount } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { config } from '../lib/config';
import { sendMail } from '../lib/email';
import { webhookLogger } from '../lib/logger';
import { logAudit } from './whatsapp-audit.service';
import { getWorkspaceOwnerEmails } from './workspace.service';

// Phase B.4 - Webhook Health. Every number here is computed live from
// WebhookEvent/WebhookDeadLetter (never a separately-maintained counter that
// could drift), matching this codebase's existing convention for derived
// stats (e.g. meta-sync.service.ts's pendingJobCount) - the only thing
// actually persisted on WhatsappAccount is the classification RESULT
// (webhookHealthStatus) and the raw event-independent signature-failure
// counter, so alert-transition detection and dashboard reads elsewhere don't
// each need to recompute the full stat set.
export type WebhookHealthLevel = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'UNKNOWN';

export interface WebhookHealthStats {
  webhookVerified: boolean;
  webhookVerifiedAt: Date | null;
  webhookSubscribed: boolean;
  lastReceivedAt: Date | null;
  eventsPerHour: number;
  eventsToday: number;
  averageProcessingTimeMs: number | null;
  lastProcessingTimeMs: number | null;
  failureRate: number;
  signatureFailures: number;
  signatureFailures24h: number;
  retryCount: number;
  deadLetters: number;
  healthStatus: WebhookHealthLevel;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const EMPTY_STATS: WebhookHealthStats = {
  webhookVerified: false,
  webhookVerifiedAt: null,
  webhookSubscribed: false,
  lastReceivedAt: null,
  eventsPerHour: 0,
  eventsToday: 0,
  averageProcessingTimeMs: null,
  lastProcessingTimeMs: null,
  failureRate: 0,
  signatureFailures: 0,
  signatureFailures24h: 0,
  retryCount: 0,
  deadLetters: 0,
  healthStatus: 'UNKNOWN',
};

// Pure classifier - given the raw stats, decide Healthy/Warning/Critical.
// Exported so both the scheduler (needs to detect a TRANSITION to decide
// whether to alert) and the on-demand API/dashboard read share exactly one
// rule set, never two that could disagree.
export const classifyWebhookHealth = (stats: {
  connected: boolean;
  webhookSubscribed: boolean;
  lastReceivedAt: Date | null;
  failureRate: number;
  deadLetters: number;
  signatureFailures24h: number;
}): WebhookHealthLevel => {
  if (!stats.connected) return 'UNKNOWN';
  if (stats.deadLetters >= config.webhook.deadLetterAlertThreshold) return 'CRITICAL';
  if (!stats.webhookSubscribed) return 'CRITICAL';
  if (stats.lastReceivedAt && Date.now() - stats.lastReceivedAt.getTime() > config.webhook.offlineAlertMs) return 'CRITICAL';
  if (stats.failureRate > 0.2) return 'CRITICAL';
  if (stats.signatureFailures24h >= config.webhook.signatureFailureAlertThreshold) return 'WARNING';
  if (stats.failureRate > 0.05) return 'WARNING';
  if (!stats.lastReceivedAt) return 'WARNING';
  return 'HEALTHY';
};

type AccountForHealth = Pick<
  WhatsappAccount,
  'id' | 'workspaceId' | 'status' | 'webhookSubscribed' | 'webhookVerified' | 'webhookVerifiedAt' | 'webhookSignatureFailures' | 'webhookLastSignatureFailureAt'
>;

// Batch computation - one groupBy/count round-trip per metric regardless of
// how many accounts are in `accounts`, so the Accounts dashboard (which
// renders every workspace member's account, not just the caller's own) never
// does one query per account (no N+1), matching meta-sync.service.ts's
// getPendingJobCountsByAccountId pattern for the same reason.
export const getWebhookHealthBatch = async (accounts: AccountForHealth[]): Promise<Map<string, WebhookHealthStats>> => {
  const result = new Map<string, WebhookHealthStats>();
  if (accounts.length === 0) return result;

  const accountIds = accounts.map((a) => a.id);
  const now = Date.now();
  const since24h = new Date(now - DAY_MS);
  const sinceHour = new Date(now - HOUR_MS);

  const [hourGroups, dayEvents, retryGroups, deadLetterGroups, lastEventGroups] = await Promise.all([
    prisma.webhookEvent.groupBy({ by: ['accountId'], where: { accountId: { in: accountIds }, receivedAt: { gte: sinceHour } }, _count: { _all: true } }),
    prisma.webhookEvent.findMany({
      where: { accountId: { in: accountIds }, receivedAt: { gte: since24h } },
      select: { accountId: true, status: true, processingTimeMs: true },
      orderBy: { receivedAt: 'desc' },
    }),
    prisma.webhookEvent.groupBy({ by: ['accountId'], where: { accountId: { in: accountIds }, status: 'RETRY_SCHEDULED' }, _count: { _all: true } }),
    prisma.webhookDeadLetter.groupBy({ by: ['accountId'], where: { accountId: { in: accountIds }, resolvedAt: null }, _count: { _all: true } }),
    prisma.webhookEvent.groupBy({ by: ['accountId'], where: { accountId: { in: accountIds } }, _max: { receivedAt: true } }),
  ]);

  const hourCountByAccount = new Map(hourGroups.map((g) => [g.accountId, g._count._all]));
  const retryByAccount = new Map(retryGroups.map((g) => [g.accountId, g._count._all]));
  const deadLetterByAccount = new Map(deadLetterGroups.map((g) => [g.accountId, g._count._all]));
  const lastEventByAccount = new Map(lastEventGroups.map((g) => [g.accountId, g._max.receivedAt]));

  const dayEventsByAccount = new Map<string, typeof dayEvents>();
  for (const event of dayEvents) {
    if (!event.accountId) continue;
    const list = dayEventsByAccount.get(event.accountId) ?? [];
    list.push(event);
    dayEventsByAccount.set(event.accountId, list);
  }

  for (const account of accounts) {
    const dayList = dayEventsByAccount.get(account.id) ?? [];
    const processedTimes = dayList.filter((e) => e.processingTimeMs != null).map((e) => e.processingTimeMs as number);
    const failed = dayList.filter((e) => e.status === 'DEAD_LETTERED').length;
    const failureRate = dayList.length > 0 ? Math.round((failed / dayList.length) * 1000) / 1000 : 0;
    const lastReceivedAt = lastEventByAccount.get(account.id) ?? null;
    const signatureFailures24h =
      account.webhookLastSignatureFailureAt && account.webhookLastSignatureFailureAt >= since24h ? account.webhookSignatureFailures : 0;
    const deadLetters = deadLetterByAccount.get(account.id) ?? 0;

    const healthStatus = classifyWebhookHealth({
      connected: account.status === 'CONNECTED',
      webhookSubscribed: account.webhookSubscribed,
      lastReceivedAt,
      failureRate,
      deadLetters,
      signatureFailures24h,
    });

    result.set(account.id, {
      webhookVerified: account.webhookVerified,
      webhookVerifiedAt: account.webhookVerifiedAt,
      webhookSubscribed: account.webhookSubscribed,
      lastReceivedAt,
      eventsPerHour: hourCountByAccount.get(account.id) ?? 0,
      eventsToday: dayList.length,
      averageProcessingTimeMs: processedTimes.length > 0 ? Math.round(processedTimes.reduce((a, b) => a + b, 0) / processedTimes.length) : null,
      lastProcessingTimeMs: dayList.find((e) => e.processingTimeMs != null)?.processingTimeMs ?? null,
      failureRate,
      signatureFailures: account.webhookSignatureFailures,
      signatureFailures24h,
      retryCount: retryByAccount.get(account.id) ?? 0,
      deadLetters,
      healthStatus,
    });
  }

  return result;
};

// Self-service - GET /account/webhook/status.
export const getWebhookHealth = async (userId: string): Promise<WebhookHealthStats & { accountId: string | null }> => {
  const account = await prisma.whatsappAccount.findUnique({ where: { userId } });
  if (!account) return { accountId: null, ...EMPTY_STATS };
  const batch = await getWebhookHealthBatch([account]);
  return { accountId: account.id, ...(batch.get(account.id) ?? EMPTY_STATS) };
};

// Called from the existing 30-min WhatsApp health scheduler tick (no second
// interval introduced). Persists the classification (so dashboard/system-
// health reads don't each recompute it) and fires the staged, deduped
// notification the brief asks for - at most once per (account, alert type)
// until the condition clears, mirroring Phase B.3's notificationType/
// notificationSentAt dedup pattern exactly, but on separate webhookNotification*
// columns so it can never collide with the token-lifecycle notification state.
// Phase B.5 - returns the freshly computed level (previously void) so
// account-quality-monitor.service.ts's monitorWebhookCriticalDisable can act
// on this exact tick's result without a second read that might still see
// the previous tick's persisted value.
export const checkAndAlertWebhookHealth = async (account: WhatsappAccount): Promise<WebhookHealthLevel> => {
  if (account.status !== 'CONNECTED') return account.webhookHealthStatus as WebhookHealthLevel;

  const batch = await getWebhookHealthBatch([account]);
  const stats = batch.get(account.id);
  if (!stats) return account.webhookHealthStatus as WebhookHealthLevel;

  if (stats.healthStatus !== account.webhookHealthStatus) {
    webhookLogger.info('WEBHOOK_HEALTH_CHANGED', { accountId: account.id, previous: account.webhookHealthStatus, next: stats.healthStatus });
  }
  await prisma.whatsappAccount.update({
    where: { id: account.id },
    data: { webhookHealthStatus: stats.healthStatus, webhookLastHealthCheckAt: new Date() },
  });

  if (!account.notifyWebhookOffline) return stats.healthStatus;

  let alertType: string | null = null;
  let reason = '';
  if (stats.deadLetters >= config.webhook.deadLetterAlertThreshold) {
    alertType = 'DEAD_LETTER_THRESHOLD';
    reason = `${stats.deadLetters} unresolved dead-lettered webhook event(s)`;
  } else if (stats.retryCount >= config.webhook.retryFailureAlertThreshold) {
    alertType = 'RETRY_FAILURE_THRESHOLD';
    reason = `${stats.retryCount} webhook event(s) stuck retrying`;
  } else if (!stats.webhookSubscribed) {
    alertType = 'OFFLINE';
    reason = 'Webhook is not currently subscribed to this account';
  } else if (stats.lastReceivedAt && Date.now() - stats.lastReceivedAt.getTime() > config.webhook.offlineAlertMs) {
    alertType = 'OFFLINE';
    reason = `No webhook event received since ${stats.lastReceivedAt.toISOString()}`;
  } else if (stats.signatureFailures24h >= config.webhook.signatureFailureAlertThreshold) {
    alertType = 'SIGNATURE_FAILURE_SPIKE';
    reason = `${stats.signatureFailures24h} invalid-signature request(s) in the last 24h`;
  }

  if (alertType && alertType !== account.webhookNotificationType) {
    await logAudit(account.userId, 'WEBHOOK_HEALTH_ALERT', `${alertType}: ${reason}`);
    if (account.notifyEmail) {
      const owners = await getWorkspaceOwnerEmails(account.workspaceId);
      if (owners.length > 0) {
        const label = account.businessName || account.displayPhoneNumber || account.phoneNumberId;
        await sendMail({
          to: owners,
          subject: `WhatsApp webhook needs attention - ${label} (${alertType})`,
          text: [
            `Business: ${label}`,
            `Phone: ${account.displayPhoneNumber || account.phoneNumberId}`,
            `Reason: ${reason}`,
            `Open the Accounts page to review webhook health and dead-lettered events.`,
            `Time detected: ${new Date().toISOString()}`,
          ].join('\n'),
        });
      }
    }
    await prisma.whatsappAccount.update({
      where: { id: account.id },
      data: { webhookNotificationType: alertType, webhookNotificationSentAt: new Date() },
    });
  } else if (!alertType && account.webhookNotificationType) {
    await prisma.whatsappAccount.update({ where: { id: account.id }, data: { webhookNotificationType: null } });
  }

  return stats.healthStatus;
};

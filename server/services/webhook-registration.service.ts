import { prisma } from '../lib/prisma';
import { decryptToken } from '../lib/whatsapp-crypto';
import { subscribeToWebhooks, getWebhookSubscriptionStatus, WhatsappGraphError } from '../lib/whatsapp-graph';
import { logAudit } from './whatsapp-audit.service';
import { webhookLogger } from '../lib/logger';

export class WebhookRegistrationError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// Phase B.4 Part "WEBHOOK REGISTRATION" - one shared implementation used by
// both connection flows the brief names (Embedded Signup completion and
// Manual Account Connection), plus the on-demand POST /account/webhook/
// re-register endpoint and the background retry sweep below. Previously this
// logic was duplicated inline inside meta-signup.service.ts; this factors it
// out (same 3-attempt/backoff behavior, now also persisting status for the
// dashboard and scheduling a background retry instead of just giving up).
const IMMEDIATE_ATTEMPTS = 3;
const IMMEDIATE_BACKOFF_BASE_MS = 1000;
// Once the immediate 3-attempt burst fails, back off further attempts to the
// same cadence as the WhatsApp health scheduler (30 min) rather than
// hammering Meta - picked up by retryPendingWebhookSubscriptions below on
// that scheduler's next tick.
const BACKGROUND_RETRY_DELAY_MS = 30 * 60 * 1000;

export interface RegisterWebhookResult {
  subscribed: boolean;
  error?: string;
}

// Best-effort: 3 immediate attempts with exponential backoff (1s/2s/4s),
// matching the brief's "3 attempts, exponential backoff. Do not block
// account connection." Never throws - a broken subscribe call must never
// undo an otherwise-successful connect. Failure is recorded on the account
// row (status + audit log) and picked up later by the background sweep, not
// retried further inline.
export const registerAccountWebhook = async (
  accountId: string,
  wabaId: string,
  accessToken: string,
  userId: string,
): Promise<RegisterWebhookResult> => {
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= IMMEDIATE_ATTEMPTS; attempt++) {
    try {
      await subscribeToWebhooks(wabaId, accessToken);
      await prisma.whatsappAccount.update({
        where: { id: accountId },
        data: {
          webhookSubscribed: true,
          lastWebhookSync: new Date(),
          webhookSubscriptionAttempts: 0,
          webhookSubscriptionError: null,
          webhookNextSubscriptionRetryAt: null,
        },
      });
      await logAudit(userId, 'WEBHOOK_REGISTERED', wabaId);
      webhookLogger.info('WEBHOOK_REGISTERED', { accountId, wabaId, attempt });
      return { subscribed: true };
    } catch (err) {
      lastError = err instanceof WhatsappGraphError ? err.message : err instanceof Error ? err.message : 'Unknown error';
      if (attempt < IMMEDIATE_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, IMMEDIATE_BACKOFF_BASE_MS * Math.pow(2, attempt - 1)));
      }
    }
  }

  const updated = await prisma.whatsappAccount.update({
    where: { id: accountId },
    data: {
      webhookSubscribed: false,
      webhookSubscriptionError: lastError ?? 'Webhook subscription failed',
      webhookSubscriptionAttempts: { increment: 1 },
      webhookNextSubscriptionRetryAt: new Date(Date.now() + BACKGROUND_RETRY_DELAY_MS),
    },
    select: { webhookSubscriptionAttempts: true },
  });
  await logAudit(userId, 'ACCOUNT_WEBHOOK_SUBSCRIBE_FAILED', lastError ?? 'Unknown error');
  webhookLogger.warn('WEBHOOK_REGISTRATION_FAILED', {
    accountId,
    wabaId,
    attempts: updated.webhookSubscriptionAttempts,
    error: lastError,
  });
  return { subscribed: false, error: lastError };
};

// Background sweep - called from the existing 30-min WhatsApp health
// scheduler tick (no second interval timer introduced). Retries subscription
// for any CONNECTED account that has a WABA id, isn't already subscribed,
// and whose backoff window has elapsed; each due account gets one more
// registerAccountWebhook attempt (its own internal 3-sub-attempt burst).
export const retryPendingWebhookSubscriptions = async (): Promise<void> => {
  const due = await prisma.whatsappAccount.findMany({
    where: {
      status: 'CONNECTED',
      webhookSubscribed: false,
      wabaId: { not: null },
      webhookNextSubscriptionRetryAt: { lte: new Date() },
    },
    select: { id: true, userId: true, wabaId: true, accessTokenEncrypted: true },
  });
  if (due.length === 0) return;

  for (const account of due) {
    if (!account.wabaId) continue;
    try {
      const accessToken = decryptToken(account.accessTokenEncrypted);
      await registerAccountWebhook(account.id, account.wabaId, accessToken, account.userId);
    } catch (err) {
      webhookLogger.error('WEBHOOK_REGISTRATION_RETRY_ERROR', {
        accountId: account.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
};

// Self-service - POST /account/webhook/verify. Distinct from the passive
// GET /webhook challenge Meta initiates on its own schedule
// (campaign-webhook.service.ts's verifyWebhookChallenge): this is an
// on-demand self-check that asks Meta directly "is this app actually
// subscribed to this WABA right now" (GET /{waba_id}/subscribed_apps), so a
// user can confirm webhook health without waiting for Meta to re-verify.
export const verifyWebhookNow = async (userId: string): Promise<{ subscribed: boolean; wabaId: string | null; checkedAt: Date }> => {
  const account = await prisma.whatsappAccount.findUnique({ where: { userId } });
  if (!account) throw new WebhookRegistrationError('No WhatsApp account is connected', 404);

  const now = new Date();
  if (!account.wabaId) {
    await prisma.whatsappAccount.update({
      where: { id: account.id },
      data: { webhookLastVerificationAttempt: now, webhookVerificationError: 'This account has no WABA id to verify' },
    });
    return { subscribed: false, wabaId: null, checkedAt: now };
  }

  try {
    const accessToken = decryptToken(account.accessTokenEncrypted);
    const subscribed = await getWebhookSubscriptionStatus(account.wabaId, accessToken);
    await prisma.whatsappAccount.update({
      where: { id: account.id },
      data: {
        webhookSubscribed: subscribed,
        webhookLastVerificationAttempt: now,
        webhookVerificationError: subscribed ? null : 'App is not subscribed to this WABA',
        ...(subscribed ? { webhookVerified: true, webhookVerifiedAt: now } : {}),
      },
    });
    await logAudit(userId, subscribed ? 'WEBHOOK_VERIFICATION_SUCCESS' : 'WEBHOOK_VERIFICATION_FAILURE', account.wabaId);
    return { subscribed, wabaId: account.wabaId, checkedAt: now };
  } catch (err) {
    const message = err instanceof WhatsappGraphError ? err.message : 'Failed to verify webhook subscription';
    await prisma.whatsappAccount.update({
      where: { id: account.id },
      data: { webhookLastVerificationAttempt: now, webhookVerificationError: message },
    });
    await logAudit(userId, 'WEBHOOK_VERIFICATION_FAILURE', message);
    throw new WebhookRegistrationError(message, err instanceof WhatsappGraphError ? err.status : 502);
  }
};

// Self-service - POST /account/webhook/re-register. Manual, immediate
// version of the same registerAccountWebhook the automatic flows use -
// useful when a user doesn't want to wait for the 30-min background sweep.
export const reRegisterWebhook = async (userId: string): Promise<RegisterWebhookResult> => {
  const account = await prisma.whatsappAccount.findUnique({ where: { userId } });
  if (!account) throw new WebhookRegistrationError('No WhatsApp account is connected', 404);
  if (!account.wabaId) throw new WebhookRegistrationError('This account has no WABA id to subscribe', 400);

  const accessToken = decryptToken(account.accessTokenEncrypted);
  return registerAccountWebhook(account.id, account.wabaId, accessToken, userId);
};

import crypto from 'crypto';
import type { CampaignQueueJob, WhatsappAccount } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { decryptToken } from '../lib/whatsapp-crypto';
import { getPresignedViewUrl } from '../lib/r2';
import { sendWhatsappMessage } from '../lib/whatsapp-sender';
import { emitCampaignProgress } from '../lib/campaign-events';
import { canSendForAccount, recordSend, recordRateLimitHit, recordSendSuccess } from '../lib/rate-limit-manager';
import { isWithinDailyLimit } from './daily-limit-engine.service';
import { recordSchedulerTick } from '../lib/scheduler-registry';

// Dedicated Worker Engine: a single polling loop (mirrors the existing
// startXCleanupScheduler() convention in server/services/*-cleanup.service.ts)
// started once from server.ts, so there is inherently no duplicate worker in
// this single-process deployment. The claim step below still uses an atomic
// conditional UPDATE (not a naive read-then-write), so it stays correct even
// if ever run from more than one process.
const POLL_INTERVAL_MS = 2000;
const STALE_LOCK_MS = 60_000;
const WORKER_INSTANCE_ID = crypto.randomUUID();

let workerTimer: NodeJS.Timeout | null = null;
let tickRunning = false;
let lastTickAt: number | null = null;

// Exposed for System Health's "Queue Worker" card - green if a tick has run
// recently, without needing a separate heartbeat table.
export const getWorkerHeartbeat = (): { running: boolean; lastTickAt: Date | null } => ({
  running: workerTimer !== null,
  lastTickAt: lastTickAt ? new Date(lastTickAt) : null,
});

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

// Working Hours: campaigns simply aren't dispatched from outside the
// configured window - jobs stay PENDING and pick back up automatically once
// the window (re)opens, no separate "waiting" job state needed.
export const isWithinWorkingHours = (account: Pick<WhatsappAccount, 'workingHoursEnabled' | 'workingHours' | 'sendTimezone'>): boolean => {
  if (!account.workingHoursEnabled || !account.workingHours) return true;
  const schedule = account.workingHours as Record<string, { enabled: boolean; start: string; end: string }>;

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: account.sendTimezone || 'UTC',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
  } catch {
    return true; // misconfigured timezone shouldn't block sending entirely
  }

  const weekdayPart = parts.find((p) => p.type === 'weekday')?.value.toLowerCase().slice(0, 3);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const dayKey = DAY_KEYS.find((d) => d === weekdayPart);
  if (!dayKey) return true;

  const today = schedule[dayKey];
  if (!today || !today.enabled) return false;

  const nowMinutes = Number(hour) * 60 + Number(minute);
  const [startH, startM] = today.start.split(':').map(Number);
  const [endH, endM] = today.end.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  return nowMinutes >= startMinutes && nowMinutes < endMinutes;
};

// --- Rate Limiter: sliding-window messages/minute + randomized jitter delay
// between consecutive sends, per WhatsApp account (per phone number).
// Phase B.5 - the limiter state/logic itself now lives in
// lib/rate-limit-manager.ts (canSendForAccount/recordSend, imported above),
// extended there with an adaptive backoff multiplier on real Meta 429s -
// this file just calls it and reports outcomes back via
// recordRateLimitHit/recordSendSuccess in processJob below. ---

// Fire-and-forget daily counter increment - mirrors processJob's own
// non-blocking dispatch pattern, never awaited on the hot tick path. The
// counter's RESET/enforcement (UTC rollover, pause-on-threshold) is Phase
// B.5's daily-limit-engine.service.ts's job now (30-min health-scheduler
// cadence) - this only increments.
const incrementDailySent = (accountId: string): void => {
  void prisma.whatsappAccount
    .update({ where: { id: accountId }, data: { currentDailySent: { increment: 1 } } })
    .catch((err) => console.error(`Failed to increment currentDailySent for account ${accountId}:`, err));
};

// --- Crash / restart recovery ---
const recoverStaleLocks = async (): Promise<void> => {
  const staleThreshold = new Date(Date.now() - STALE_LOCK_MS);
  await prisma.campaignQueueJob.updateMany({
    where: { status: 'SENDING', lockedAt: { lt: staleThreshold } },
    data: { status: 'PENDING', lockedAt: null, lockedBy: null },
  });
};

// --- Scheduler: promote due SCHEDULED campaigns automatically ---
const promoteScheduledCampaigns = async (): Promise<void> => {
  const due = await prisma.campaign.findMany({
    where: { sendStatus: 'SCHEDULED', scheduledAt: { lte: new Date() } },
    select: { id: true },
  });
  if (due.length === 0) return;
  await prisma.campaign.updateMany({
    where: { id: { in: due.map((d) => d.id) }, sendStatus: 'SCHEDULED' },
    data: { sendStatus: 'SENDING', queueStartedAt: new Date() },
  });
  due.forEach((d) => emitCampaignProgress(d.id));
};

const maybeCompleteCampaign = async (campaignId: string): Promise<void> => {
  const remaining = await prisma.campaignQueueJob.count({
    where: { campaignId, status: { in: ['PENDING', 'WAITING', 'SENDING', 'RETRY'] } },
  });
  if (remaining === 0) {
    const result = await prisma.campaign.updateMany({
      where: { id: campaignId, sendStatus: 'SENDING' },
      data: { sendStatus: 'COMPLETED', queueCompletedAt: new Date() },
    });
    if (result.count > 0) emitCampaignProgress(campaignId);
  }
};

// Atomic claim: read the best candidate, then conditionally UPDATE it back to
// SENDING only if it's still in a claimable state. If another worker already
// claimed it between the read and the write, the UPDATE affects 0 rows and we
// correctly report "nothing claimed" instead of double-processing.
const claimOneJob = async (campaignId: string): Promise<CampaignQueueJob | null> => {
  const now = new Date();
  const claimableWhere = {
    OR: [
      { status: { in: ['PENDING', 'WAITING'] as ('PENDING' | 'WAITING')[] } },
      { status: 'RETRY' as const, nextAttemptAt: { lte: now } },
    ],
  };

  const candidate = await prisma.campaignQueueJob.findFirst({
    where: { campaignId, ...claimableWhere },
    orderBy: { queuedAt: 'asc' },
  });
  if (!candidate) return null;

  const claim = await prisma.campaignQueueJob.updateMany({
    where: { id: candidate.id, ...claimableWhere },
    data: { status: 'SENDING', lockedAt: now, lockedBy: WORKER_INSTANCE_ID, startedAt: now },
  });
  if (claim.count === 0) return null;

  return { ...candidate, status: 'SENDING', lockedAt: now, lockedBy: WORKER_INSTANCE_ID, startedAt: now };
};

const processJob = async (
  job: CampaignQueueJob,
  account: WhatsappAccount,
  accessToken: string,
  mediaType: 'IMAGE' | 'PDF' | 'DOCUMENT' | 'VIDEO' | undefined,
  mediaLink: string | undefined,
): Promise<void> => {
  const attemptNumber = job.attempts + 1;
  const start = Date.now();

  const result = await sendWhatsappMessage({
    phoneNumberId: account.phoneNumberId,
    accessToken,
    to: job.recipientPhone,
    text: job.renderedMessage,
    mediaLink,
    mediaType,
  }).catch((err: any) => ({
    success: false as const,
    retryable: true,
    errorCategory: 'UNKNOWN' as const,
    errorMessage: err?.message || 'Unexpected error while sending',
    httpStatus: 0,
    rawResponse: null,
  }));

  const durationMs = Date.now() - start;
  const willRetry = !result.success && result.retryable && attemptNumber < job.maxAttempts;
  const logStatus = result.success ? 'SENT' : willRetry ? 'RETRY' : 'FAILED';

  // Phase B.5 - Rate Limit Manager feedback loop: a real Meta 429 grows the
  // adaptive backoff for this account; any successful send decays it back
  // down. Every other error category is neither - it neither means "we're
  // sending too fast" nor "we're clear to speed back up."
  if (result.success) {
    recordSendSuccess(account.id);
  } else if (result.errorCategory === 'RATE_LIMIT') {
    recordRateLimitHit(account.id);
  }

  await prisma.campaignSendLog.create({
    data: {
      jobId: job.id,
      campaignId: job.campaignId,
      attempt: attemptNumber,
      status: logStatus,
      durationMs,
      errorCode: result.success ? null : result.errorCategory,
      errorMessage: result.success ? null : result.errorMessage,
      responseBody: result.rawResponse ?? undefined,
    },
  });

  if (result.success) {
    await prisma.campaignQueueJob.update({
      where: { id: job.id },
      data: {
        status: 'SENT',
        completedAt: new Date(),
        metaMessageId: result.metaMessageId,
        deliveryStatus: 'SENT',
        attempts: attemptNumber,
        errorCode: null,
        errorMessage: null,
      },
    });
  } else if (willRetry) {
    const baseBackoffMs = (account.retryDelaySeconds || 30) * 1000;
    const backoffMs = baseBackoffMs * Math.pow(2, attemptNumber - 1);
    await prisma.campaignQueueJob.update({
      where: { id: job.id },
      data: {
        status: 'RETRY',
        attempts: attemptNumber,
        nextAttemptAt: new Date(Date.now() + backoffMs),
        errorCode: result.errorCategory,
        errorMessage: result.errorMessage,
      },
    });
  } else {
    await prisma.campaignQueueJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        attempts: attemptNumber,
        errorCode: result.errorCategory,
        errorMessage: result.errorMessage,
      },
    });
  }

  await maybeCompleteCampaign(job.campaignId);
  emitCampaignProgress(job.campaignId);
};

// Dispatches at most one new send per WhatsApp account per tick (the rate
// limiter's jitter delay naturally paces how often that's actually allowed),
// while up to `maxConcurrentJobs` sends can be in flight simultaneously per
// account since dispatched jobs aren't awaited here - they run in the
// background and the next tick's in-flight count reflects them.
// Resolves which WhatsappAccount a campaign sends from, same fallback rule as
// campaign-queue.service.ts's resolveAccountForCampaign (duplicated here in
// query form rather than imported, since this hot loop wants a memoized,
// batched lookup instead of one Prisma round-trip per campaign per tick).
const dispatchNextBatch = async (): Promise<void> => {
  const activeCampaigns = await prisma.campaign.findMany({
    where: { sendStatus: 'SENDING' },
    include: { attachment: true },
  });
  if (activeCampaigns.length === 0) return;

  // Memoized per-tick userId -> accountId lookup, so legacy (null-FK)
  // campaigns sharing an owner don't each issue a duplicate query.
  const accountIdByUserId = new Map<string, string | null>();
  const resolveLegacyAccountId = async (userId: string): Promise<string | null> => {
    if (accountIdByUserId.has(userId)) return accountIdByUserId.get(userId)!;
    const account = await prisma.whatsappAccount.findUnique({ where: { userId }, select: { id: true } });
    const id = account?.id ?? null;
    accountIdByUserId.set(userId, id);
    return id;
  };

  const byAccountId = new Map<string, typeof activeCampaigns>();
  for (const campaign of activeCampaigns) {
    const accountId = campaign.whatsappAccountId ?? (await resolveLegacyAccountId(campaign.userId));
    if (!accountId) continue; // no resolvable account at all - same as today's "account not found" skip
    const list = byAccountId.get(accountId) ?? [];
    list.push(campaign);
    byAccountId.set(accountId, list);
  }

  for (const [accountId, campaigns] of byAccountId) {
    const account = await prisma.whatsappAccount.findUnique({ where: { id: accountId } });
    if (!account || account.status !== 'CONNECTED') continue;
    if (!account.sendingEnabled) continue;
    if (!isWithinWorkingHours(account)) continue;
    if (!canSendForAccount(account.id, account)) continue;
    if (!isWithinDailyLimit(account)) continue;

    // This account's own bucket already contains exactly the campaigns
    // resolved to it this tick (explicit FK match or legacy fallback), so the
    // in-flight count is correctly scoped per-account without needing a
    // union condition - two campaigns sharing an account share this budget;
    // two campaigns on different accounts never compete for it.
    const inFlight = await prisma.campaignQueueJob.count({
      where: { status: 'SENDING', campaignId: { in: campaigns.map((c) => c.id) } },
    });
    if (inFlight >= account.maxConcurrentJobs) continue;

    for (const campaign of campaigns) {
      const claimed = await claimOneJob(campaign.id);
      if (!claimed) {
        await maybeCompleteCampaign(campaign.id);
        continue;
      }

      // Phase B.6 - a corrupted/malformed stored token (bad migration, manual
      // DB edit, key rotation without re-encrypting existing rows, ...) must
      // never abort the whole tick - decryptToken throws synchronously, and
      // this call previously sat outside any try/catch, so one broken
      // account's exception propagated all the way out of dispatchNextBatch
      // and killed every other account's dispatch for that tick (live-
      // reproduced during audit: "Invalid authentication tag length" from a
      // malformed ciphertext aborted the tick and left the claimed job stuck
      // in SENDING). Isolate the failure to this one job/account instead.
      let accessToken: string;
      try {
        accessToken = decryptToken(account.accessTokenEncrypted);
      } catch (err) {
        console.error(`Failed to decrypt access token for account ${account.id}:`, err);
        await prisma.campaignQueueJob.update({
          where: { id: claimed.id },
          data: {
            status: 'FAILED',
            failedAt: new Date(),
            attempts: claimed.attempts + 1,
            errorCode: 'UNKNOWN',
            errorMessage: 'Stored access token could not be read',
          },
        });
        await maybeCompleteCampaign(campaign.id);
        emitCampaignProgress(campaign.id);
        break; // this account is broken for the rest of this tick - move on to the next account, not abort the tick
      }

      recordSend(account.id, account);
      incrementDailySent(account.id);
      let mediaLink: string | undefined;
      if (campaign.attachment) {
        mediaLink = await getPresignedViewUrl(campaign.attachment.storageKey).catch(() => undefined);
      }
      void processJob(claimed, account, accessToken, campaign.attachment?.type, mediaLink);
      break; // one claim per account per tick - pacing is enforced by the rate limiter, not by batch size
    }
  }
};

const tick = async (): Promise<void> => {
  if (tickRunning) return;
  tickRunning = true;
  const startedAt = Date.now();
  try {
    await recoverStaleLocks();
    await promoteScheduledCampaigns();
    await dispatchNextBatch();
    lastTickAt = Date.now();
    recordSchedulerTick('campaign-queue-worker', Date.now() - startedAt);
  } catch (err) {
    console.error('Campaign queue worker tick error:', err);
    recordSchedulerTick('campaign-queue-worker', Date.now() - startedAt, err instanceof Error ? err.message : String(err));
  } finally {
    tickRunning = false;
  }
};

export const startCampaignQueueWorker = (): void => {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);
  console.log(`Campaign queue worker started (instance ${WORKER_INSTANCE_ID})`);
};

// Graceful shutdown: stop scheduling new ticks, then wait for any in-flight
// tick to finish before the process actually exits.
export const stopCampaignQueueWorker = async (): Promise<void> => {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
  while (tickRunning) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

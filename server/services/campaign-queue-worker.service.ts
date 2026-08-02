import crypto from 'crypto';
import type { CampaignQueueJob, WhatsappAccount } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { decryptToken } from '../lib/whatsapp-crypto';
import { getPresignedViewUrl } from '../lib/r2';
import { sendWhatsappMessage } from '../lib/whatsapp-sender';
import { emitCampaignProgress } from '../lib/campaign-events';

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
// between consecutive sends, per WhatsApp account (per phone number). ---
interface RateState {
  sentTimestamps: number[];
  nextAllowedAt: number;
}
const rateState = new Map<string, RateState>();

const getRateState = (accountId: string): RateState => {
  let state = rateState.get(accountId);
  if (!state) {
    state = { sentTimestamps: [], nextAllowedAt: 0 };
    rateState.set(accountId, state);
  }
  return state;
};

const canSendForAccount = (accountId: string, account: Pick<WhatsappAccount, 'rateLimitPerMinute'>): boolean => {
  const state = getRateState(accountId);
  const now = Date.now();
  if (now < state.nextAllowedAt) return false;
  state.sentTimestamps = state.sentTimestamps.filter((t) => now - t < 60_000);
  return state.sentTimestamps.length < account.rateLimitPerMinute;
};

const recordSend = (accountId: string, account: Pick<WhatsappAccount, 'minDelaySeconds' | 'maxDelaySeconds'>): void => {
  const state = getRateState(accountId);
  const now = Date.now();
  state.sentTimestamps.push(now);
  const min = Math.max(1, account.minDelaySeconds);
  const max = Math.max(min, account.maxDelaySeconds);
  const jitterSeconds = min + Math.random() * (max - min); // random, not fixed
  state.nextAllowedAt = now + jitterSeconds * 1000;
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
const dispatchNextBatch = async (): Promise<void> => {
  const activeCampaigns = await prisma.campaign.findMany({
    where: { sendStatus: 'SENDING' },
    include: { attachment: true },
  });
  if (activeCampaigns.length === 0) return;

  const byUser = new Map<string, typeof activeCampaigns>();
  for (const campaign of activeCampaigns) {
    const list = byUser.get(campaign.userId) ?? [];
    list.push(campaign);
    byUser.set(campaign.userId, list);
  }

  for (const [userId, campaigns] of byUser) {
    const account = await prisma.whatsappAccount.findUnique({ where: { userId } });
    if (!account || account.status !== 'CONNECTED') continue;
    if (!isWithinWorkingHours(account)) continue;
    if (!canSendForAccount(account.id, account)) continue;

    const inFlight = await prisma.campaignQueueJob.count({
      where: { status: 'SENDING', campaign: { userId } },
    });
    if (inFlight >= account.maxConcurrentJobs) continue;

    for (const campaign of campaigns) {
      const claimed = await claimOneJob(campaign.id);
      if (!claimed) {
        await maybeCompleteCampaign(campaign.id);
        continue;
      }

      recordSend(account.id, account);
      const accessToken = decryptToken(account.accessTokenEncrypted);
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
  try {
    await recoverStaleLocks();
    await promoteScheduledCampaigns();
    await dispatchNextBatch();
    lastTickAt = Date.now();
  } catch (err) {
    console.error('Campaign queue worker tick error:', err);
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

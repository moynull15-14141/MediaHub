import type { WebhookEvent } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { config } from '../lib/config';
import { webhookLogger } from '../lib/logger';
import { WebhookProcessingError } from '../lib/webhook-errors';
import { dispatchWebhookEvent } from './webhook-dispatch.service';
import { moveToDeadLetter } from './webhook-dead-letter.service';
import { recordSchedulerTick } from '../lib/scheduler-registry';

// Dedicated Worker Engine for the webhook queue - mirrors campaign-queue-
// worker.service.ts's exact convention (bare setInterval + re-entrancy guard
// + atomic conditional-UPDATE claim), the established pattern in this
// codebase for "process a DB-backed queue" rather than introducing Redis/
// BullMQ. This is what makes webhook processing genuinely asynchronous: the
// controller only ever INSERTs WebhookEvent rows (campaign-webhook.service's
// ingestWebhookPayload) and returns immediately; all the real work - and any
// retry/backoff/dead-lettering - happens here, off the HTTP request path.
const POLL_INTERVAL_MS = 3000;
const BATCH_SIZE = 25;
const STALE_PROCESSING_MS = 60_000;

let workerTimer: NodeJS.Timeout | null = null;
let tickRunning = false;
let lastTickAt: number | null = null;

export const getWebhookWorkerHeartbeat = (): { running: boolean; lastTickAt: Date | null } => ({
  running: workerTimer !== null,
  lastTickAt: lastTickAt ? new Date(lastTickAt) : null,
});

// Server restart recovery: a row stuck in PROCESSING (the process crashed or
// was killed mid-handler) is never retried by the claim query below (it only
// looks at RECEIVED/RETRY_SCHEDULED) - this reverts anything that's been
// PROCESSING for longer than one process could plausibly still be working on
// it back to RECEIVED, so it's picked up again on the very next tick.
const recoverStaleProcessing = async (): Promise<void> => {
  const staleThreshold = new Date(Date.now() - STALE_PROCESSING_MS);
  await prisma.webhookEvent.updateMany({
    where: { status: 'PROCESSING', updatedAt: { lt: staleThreshold } },
    data: { status: 'RECEIVED' },
  });
};

// Atomic claim: read candidates, then conditionally UPDATE each one back to
// PROCESSING only if it's still in the state we read it in. If a second
// worker (or a future multi-instance deployment) claimed it first, the
// UPDATE affects 0 rows and it's correctly skipped rather than double-
// processed - same technique as campaign-queue-worker.service.ts's
// claimOneJob.
const claimBatch = async (limit: number): Promise<WebhookEvent[]> => {
  const now = new Date();
  const candidates = await prisma.webhookEvent.findMany({
    where: {
      OR: [{ status: 'RECEIVED' }, { status: 'RETRY_SCHEDULED', nextRetryAt: { lte: now } }],
    },
    orderBy: { receivedAt: 'asc' },
    take: limit,
  });

  const claimed: WebhookEvent[] = [];
  for (const candidate of candidates) {
    const result = await prisma.webhookEvent.updateMany({
      where: { id: candidate.id, status: candidate.status },
      data: { status: 'PROCESSING' },
    });
    if (result.count > 0) claimed.push(candidate);
  }
  return claimed;
};

const processEvent = async (event: WebhookEvent): Promise<void> => {
  const startedAt = Date.now();
  try {
    await dispatchWebhookEvent(event);
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: 'PROCESSED', processedAt: new Date(), processingTimeMs: Date.now() - startedAt, errorMessage: null },
    });
  } catch (err) {
    const processingTimeMs = Date.now() - startedAt;
    const retryable = !(err instanceof WebhookProcessingError) || err.retryable;
    const message = err instanceof Error ? err.message : 'Unknown processing error';
    const nextRetryCount = event.retryCount + 1;
    const maxRetries = event.maxRetries || config.webhook.maxRetryAttempts;

    if (!retryable || nextRetryCount > maxRetries) {
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: { retryCount: nextRetryCount, errorMessage: message, processingTimeMs },
      });
      await moveToDeadLetter(event.id, message, nextRetryCount);
      webhookLogger.error('WEBHOOK_FAILED', { eventId: event.eventId, eventType: event.eventType, error: message, retryable, attempts: nextRetryCount });
      return;
    }

    const ladder = config.webhook.retryLadderMs;
    const delayMs = ladder[Math.min(nextRetryCount - 1, ladder.length - 1)];
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: {
        status: 'RETRY_SCHEDULED',
        retryCount: nextRetryCount,
        nextRetryAt: new Date(Date.now() + delayMs),
        errorMessage: message,
        processingTimeMs,
      },
    });
    webhookLogger.warn('WEBHOOK_RETRIED', {
      eventId: event.eventId,
      eventType: event.eventType,
      retryCount: nextRetryCount,
      nextRetryInMs: delayMs,
      error: message,
    });
  }
};

// Phase B.6 - live-reproduced during production audit: multiple status
// events for the SAME message (e.g. delivered + read arriving within the
// same ~3s poll window - a realistic, common case, not just an edge case)
// landed in one claimBatch() and were processed fully concurrently below.
// delivery-status.service.ts's applyStatusEvent does a read (current
// deliveryStatus) then a conditional write as two separate, non-atomic
// steps; with N concurrent calls against the same CampaignQueueJob row,
// each one's write can land after another's regardless of which one's
// shouldApplyTransition decision was actually correct - "last write wins"
// silently overwrote a correct READ back down to DELIVERED in testing.
// Root cause is the concurrency itself, not the transition logic (which is
// correct in isolation) - so the fix is here: events sharing a wamid are
// applied one at a time, in claim order (already receivedAt-ascending from
// claimBatch), while events for DIFFERENT messages/accounts still run fully
// in parallel, so overall worker throughput is unaffected.
const groupByWamid = (batch: WebhookEvent[]): WebhookEvent[][] => {
  const groups = new Map<string, WebhookEvent[]>();
  for (const event of batch) {
    const key = event.wamid ?? `__ungrouped__${event.id}`;
    const list = groups.get(key) ?? [];
    list.push(event);
    groups.set(key, list);
  }
  return [...groups.values()];
};

const processGroupSequentially = async (group: WebhookEvent[]): Promise<void> => {
  for (const event of group) {
    await processEvent(event);
  }
};

const tick = async (): Promise<void> => {
  if (tickRunning) return;
  tickRunning = true;
  const startedAt = Date.now();
  try {
    await recoverStaleProcessing();
    const batch = await claimBatch(BATCH_SIZE);
    if (batch.length > 0) {
      await Promise.allSettled(groupByWamid(batch).map(processGroupSequentially));
    }
    lastTickAt = Date.now();
    recordSchedulerTick('webhook-event-worker', Date.now() - startedAt);
  } catch (err) {
    console.error('Webhook event worker tick error:', err);
    recordSchedulerTick('webhook-event-worker', Date.now() - startedAt, err instanceof Error ? err.message : String(err));
  } finally {
    tickRunning = false;
  }
};

export const startWebhookEventWorker = (): void => {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);
  console.log('Webhook event worker started');
};

export const stopWebhookEventWorker = async (): Promise<void> => {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
  while (tickRunning) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

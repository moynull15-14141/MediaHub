import { prisma } from '../lib/prisma';
import { config } from '../lib/config';
import { emitCampaignProgress } from '../lib/campaign-events';
import { webhookLogger } from '../lib/logger';
import { recordSchedulerTick } from '../lib/scheduler-registry';

// Phase B.4 - Event Reconciliation. Meta's Cloud API has no supported
// endpoint to re-query an already-sent message's delivery status on demand -
// status only ever arrives via webhook, there is no "GET message status by
// id." So "re-query Meta if supported" resolves honestly to "not supported
// today"; kept as its own hook so a future Graph API capability can be wired
// in here without touching the sweep logic below, rather than as a
// pseudo-code placeholder pretending it already works.
const attemptMetaStatusRequery = async (_metaMessageId: string): Promise<'DELIVERED' | 'READ' | 'FAILED' | null> => {
  return null;
};

let timer: NodeJS.Timeout | null = null;
let tickRunning = false;
let lastTickAt: number | null = null;
let lastReconciledCount = 0;

export const getReconciliationHeartbeat = (): { running: boolean; lastTickAt: Date | null; lastReconciledCount: number } => ({
  running: timer !== null,
  lastTickAt: lastTickAt ? new Date(lastTickAt) : null,
  lastReconciledCount,
});

// "Stuck in SENT" per the brief: dispatch succeeded (job.status === 'SENT')
// but no delivery confirmation ever arrived (deliveryStatus never advanced
// past the 'SENT' the worker stamps at dispatch time), for longer than the
// configured stale window.
const findStuckJobs = () => {
  const staleBefore = new Date(Date.now() - config.webhook.reconcileStaleMs);
  return prisma.campaignQueueJob.findMany({
    where: { status: 'SENT', deliveryStatus: 'SENT', completedAt: { lt: staleBefore } },
    select: { id: true, campaignId: true, metaMessageId: true },
    take: 500,
  });
};

const runReconciliation = async (): Promise<void> => {
  const stuck = await findStuckJobs();
  if (stuck.length === 0) {
    lastReconciledCount = 0;
    return;
  }

  let reconciled = 0;
  for (const job of stuck) {
    const resolvedStatus = job.metaMessageId ? await attemptMetaStatusRequery(job.metaMessageId) : null;
    // Never leave a permanent stale state: mark UNKNOWN when Meta can't be
    // re-queried, rather than leaving deliveryStatus looking like a normal,
    // still-progressing SENT message forever.
    await prisma.campaignQueueJob.update({
      where: { id: job.id },
      data: { deliveryStatus: (resolvedStatus ?? 'UNKNOWN') as any, lastStatusEventAt: new Date() },
    });
    emitCampaignProgress(job.campaignId);
    reconciled += 1;
  }

  lastReconciledCount = reconciled;
  webhookLogger.info('WEBHOOK_RECONCILIATION_SWEEP', { staleJobsFound: stuck.length, reconciled });
};

const tick = async (): Promise<void> => {
  if (tickRunning) return;
  tickRunning = true;
  const startedAt = Date.now();
  try {
    await runReconciliation();
    lastTickAt = Date.now();
    recordSchedulerTick('webhook-reconciliation', Date.now() - startedAt);
  } catch (err) {
    console.error('Webhook reconciliation tick error:', err);
    recordSchedulerTick('webhook-reconciliation', Date.now() - startedAt, err instanceof Error ? err.message : String(err));
  } finally {
    tickRunning = false;
  }
};

export const startWebhookReconciliationScheduler = (): void => {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, config.webhook.reconcileIntervalMs);
  console.log('Webhook reconciliation scheduler started');
};

export const stopWebhookReconciliationScheduler = async (): Promise<void> => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  while (tickRunning) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

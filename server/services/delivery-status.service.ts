import { prisma } from '../lib/prisma';
import { emitCampaignProgress } from '../lib/campaign-events';
import { webhookLogger } from '../lib/logger';
import { WebhookProcessingError } from '../lib/webhook-errors';

// Phase B.4 - Delivery Status Engine. Supersedes campaign-webhook.service.ts's
// old inline STATUS_MAP/processStatusWebhook loop (Phase 4): same
// correlation-by-metaMessageId and same webhookLast* account stamping, now
// covering all 5 statuses Meta's Cloud API actually sends (sent/delivered/
// read/failed/deleted - "warning" is metadata attached to a status event,
// not itself a delivery stage, see below) plus conversation/pricing/error
// persistence and an explicit status-transition guard. Called by
// webhook-event-worker.service.ts once per queued WebhookEvent row, never
// directly from the controller - the controller only ever fast-acks and
// enqueues (see campaign-webhook.service.ts's ingestWebhookPayload).
export type MetaStatusValue = 'sent' | 'delivered' | 'read' | 'failed' | 'deleted';

const STATUS_MAP: Record<MetaStatusValue, 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'DELETED'> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
  deleted: 'DELETED',
};

// Status Transitions: SENT -> DELIVERED -> READ is the only forward path.
// FAILED/DELETED are terminal and may occur at any stage (a message can fail
// or be reported deleted before, between, or after the earlier stages
// arrive - webhook delivery order isn't guaranteed). An incoming status
// ranked below the current one arrived out of order (e.g. a delayed
// "delivered" landing after "read" already did) - it is still durably
// recorded as its own WebhookEvent row (idempotency/audit trail intact) but
// must never regress deliveryStatus. Once terminal, deliveryStatus never
// moves again - a message report as "read" arriving after "failed" (or vice
// versa) is exactly the out-of-order case the brief asks to guard against.
const RANK: Record<string, number> = { UNKNOWN: 0, SENT: 1, DELIVERED: 2, READ: 3 };
const TERMINAL = new Set(['FAILED', 'DELETED']);

export const shouldApplyTransition = (current: string, incoming: string): boolean => {
  if (TERMINAL.has(current)) return false;
  if (TERMINAL.has(incoming)) return true;
  return (RANK[incoming] ?? 0) > (RANK[current] ?? 0);
};

export interface StatusUnit {
  id?: string;
  status?: string;
  timestamp?: string;
  conversation?: { id?: string; origin?: { type?: string } };
  pricing?: { category?: string; pricing_model?: string };
  errors?: { code?: number; title?: string; message?: string }[];
  warnings?: { code?: number | string; description?: string }[];
}

// Applies one status unit (one entry of change.value.statuses[]) to the
// matching CampaignQueueJob. Throws WebhookProcessingError(retryable=false)
// only for a structurally-unusable unit (no message id) - everything else
// (unmatched job, unrecognized future status value) is a legitimate no-op,
// not a failure, so it must not consume a retry attempt.
export const applyStatusEvent = async (unit: StatusUnit): Promise<void> => {
  const metaMessageId = unit?.id;
  if (!metaMessageId) {
    throw new WebhookProcessingError('Status event missing message id', false);
  }

  const rawStatus = (unit.status || '').toLowerCase();
  const mapped = STATUS_MAP[rawStatus as MetaStatusValue];

  const job = await prisma.campaignQueueJob.findUnique({ where: { metaMessageId } });
  if (!job) {
    // Arrived before (or without) a matching queue job - e.g. delivered
    // before the send-side DB write committed. Nothing to update yet.
    webhookLogger.info('WEBHOOK_STATUS_UNMATCHED', { metaMessageId, status: unit.status });
    return;
  }

  const now = unit.timestamp && !Number.isNaN(Number(unit.timestamp)) ? new Date(Number(unit.timestamp) * 1000) : new Date();
  const data: Record<string, unknown> = { lastStatusEventAt: now };

  if (unit.conversation?.id) data.conversationId = unit.conversation.id;
  if (unit.conversation?.origin?.type) data.conversationOrigin = unit.conversation.origin.type;
  if (unit.pricing?.category) data.pricingCategory = unit.pricing.category;
  if (unit.pricing?.pricing_model) data.pricingModel = unit.pricing.pricing_model;

  // Warnings (e.g. a tier/quality notice) are metadata attached to a status
  // event, not a delivery stage of their own - a message can be "sent" AND
  // carry a warning simultaneously, so this never touches deliveryStatus.
  if (unit.warnings?.length) {
    data.lastWarningCode = unit.warnings[0].code != null ? String(unit.warnings[0].code) : null;
    data.lastWarningMessage = unit.warnings[0].description ?? null;
    data.lastWarningAt = now;
  }

  if (!mapped) {
    // Genuinely unrecognized status value (a future Meta addition) - persist
    // what we can (timestamp/conversation/pricing/warnings) but there's no
    // deliveryStatus to transition to. Not a failure - retrying can never
    // teach us what an unknown string means.
    await prisma.campaignQueueJob.update({ where: { id: job.id }, data });
    webhookLogger.warn('WEBHOOK_UNKNOWN_STATUS', { metaMessageId, status: unit.status });
    return;
  }

  if (shouldApplyTransition(job.deliveryStatus, mapped)) {
    data.deliveryStatus = mapped;
    if (mapped === 'DELIVERED' && !job.deliveredAt) data.deliveredAt = now;
    if (mapped === 'READ' && !job.readAt) data.readAt = now;
    if (mapped === 'DELETED' && !job.deletedAt) data.deletedAt = now;
    if (mapped === 'FAILED') {
      data.errorCode = unit.errors?.[0]?.code != null ? String(unit.errors[0].code) : job.errorCode;
      data.errorMessage = unit.errors?.[0]?.message || unit.errors?.[0]?.title || 'Message delivery failed';
    }
  }

  await prisma.campaignQueueJob.update({ where: { id: job.id }, data });
  emitCampaignProgress(job.campaignId);

  const campaign = await prisma.campaign.findUnique({ where: { id: job.campaignId }, select: { userId: true } });
  if (campaign) {
    const accountExtra: Record<string, unknown> = { webhookLastPingAt: now };
    if (mapped === 'DELIVERED') accountExtra.webhookLastDeliveryAt = now;
    if (mapped === 'READ') accountExtra.webhookLastReadAt = now;
    if (mapped === 'FAILED') {
      accountExtra.webhookLastErrorAt = now;
      accountExtra.webhookLastErrorMessage = unit.errors?.[0]?.title || 'Message delivery failed';
    }
    await prisma.whatsappAccount.update({ where: { userId: campaign.userId }, data: accountExtra }).catch(() => {});
  }
};

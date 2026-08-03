import { prisma } from '../lib/prisma';
import { webhookLogger } from '../lib/logger';
import { logAudit } from './whatsapp-audit.service';
import { dispatchWebhookEvent } from './webhook-dispatch.service';

export class WebhookDeadLetterError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// Called by webhook-event-worker.service.ts once a WebhookEvent has either
// exhausted its retry ladder or failed with a non-retryable error. Moves it
// into WebhookDeadLetter (upsert - a race between two ticks both deciding to
// dead-letter the same event can never create a duplicate row) and marks the
// source event DEAD_LETTERED so it's excluded from the retry-claim query.
export const moveToDeadLetter = async (webhookEventId: string, reason: string, attempts: number): Promise<void> => {
  const event = await prisma.webhookEvent.findUnique({ where: { id: webhookEventId } });
  if (!event) return;

  await prisma.$transaction([
    prisma.webhookEvent.update({ where: { id: webhookEventId }, data: { status: 'DEAD_LETTERED', errorMessage: reason } }),
    prisma.webhookDeadLetter.upsert({
      where: { webhookEventId },
      create: {
        webhookEventId,
        workspaceId: event.workspaceId,
        accountId: event.accountId,
        eventType: event.eventType,
        payload: event.rawPayload as any,
        reason,
        attempts,
      },
      update: { reason, attempts },
    }),
  ]);

  webhookLogger.error('WEBHOOK_DEAD_LETTER', { eventId: event.eventId, eventType: event.eventType, reason, attempts });
  if (event.accountId) {
    const account = await prisma.whatsappAccount.findUnique({ where: { id: event.accountId }, select: { userId: true } });
    if (account) await logAudit(account.userId, 'WEBHOOK_DEAD_LETTERED', `${event.eventType}: ${reason}`);
  }
};

export interface ListDeadLettersOptions {
  page?: number;
  pageSize?: number;
}

// Self-service (caller's own account), matching every other GET /account/*
// list endpoint's pagination shape (listAuditLogs/listHealthHistory/
// getCampaignLogs). An account with no dead letters (the common, healthy
// case) just returns an empty page rather than erroring.
export const listDeadLetters = async (userId: string, options: ListDeadLettersOptions) => {
  const account = await prisma.whatsappAccount.findUnique({ where: { userId }, select: { id: true } });
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 25));
  if (!account) return { items: [], total: 0, page, pageSize, totalPages: 1 };

  const where = { accountId: account.id };
  const [items, total] = await Promise.all([
    prisma.webhookDeadLetter.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.webhookDeadLetter.count({ where }),
  ]);
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

// POST /account/webhook/replay - admin-triggered manual replay. Re-runs the
// event through the exact same dispatch path a normal worker tick uses
// (webhook-dispatch.service.ts), so replaying can never behave differently
// than the automatic path did. Scoped to the caller's own account, same
// self-service boundary as every other /account/* route.
export const replayDeadLetter = async (userId: string, deadLetterId: string): Promise<{ status: string }> => {
  const deadLetter = await prisma.webhookDeadLetter.findUnique({
    where: { id: deadLetterId },
    include: { webhookEvent: true },
  });
  if (!deadLetter) throw new WebhookDeadLetterError('Dead letter not found', 404);

  const account = await prisma.whatsappAccount.findUnique({ where: { userId } });
  if (!account || deadLetter.accountId !== account.id) {
    throw new WebhookDeadLetterError('Dead letter not found', 404);
  }

  try {
    await dispatchWebhookEvent(deadLetter.webhookEvent);
    const now = new Date();
    await prisma.$transaction([
      prisma.webhookEvent.update({
        where: { id: deadLetter.webhookEventId },
        data: { status: 'PROCESSED', processedAt: now, errorMessage: null },
      }),
      prisma.webhookDeadLetter.update({
        where: { id: deadLetter.id },
        data: { resolvedAt: now, resolvedBy: userId, replayCount: { increment: 1 } },
      }),
    ]);
    await logAudit(userId, 'WEBHOOK_REPLAYED', `${deadLetter.eventType} (${deadLetter.id})`);
    webhookLogger.info('WEBHOOK_REPLAYED', { deadLetterId: deadLetter.id, eventType: deadLetter.eventType });
    return { status: 'PROCESSED' };
  } catch (err) {
    await prisma.webhookDeadLetter.update({ where: { id: deadLetter.id }, data: { replayCount: { increment: 1 } } });
    const message = err instanceof Error ? err.message : 'Replay failed';
    await logAudit(userId, 'WEBHOOK_REPLAY_FAILED', `${deadLetter.eventType} (${deadLetter.id}): ${message}`);
    throw new WebhookDeadLetterError(`Replay failed: ${message}`, 502);
  }
};

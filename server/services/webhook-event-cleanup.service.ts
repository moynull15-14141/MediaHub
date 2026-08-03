import { prisma } from '../lib/prisma';
import { config } from '../lib/config';
import { recordSchedulerTick } from '../lib/scheduler-registry';

// Mirrors converter-cleanup.service.ts/image-cleanup.service.ts/pdf-cleanup.
// service.ts's exact convention (fire once at startup, then a bare
// setInterval - no stop() wired into server.ts's shutdown, same as those
// three). Slower cadence than them (6h vs their 5min) since webhook events
// are lightweight DB rows with no R2 object to reap alongside them.
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Only prunes terminal, resolved rows: PROCESSED events, and DEAD_LETTERED
// events whose dead-letter has already been resolved (replayed or otherwise
// closed out). An unresolved dead letter is retained indefinitely regardless
// of age - it's exactly the "needs attention" record an admin has not yet
// acted on, and must never silently disappear.
const runSweep = async (): Promise<void> => {
  const startedAt = Date.now();
  try {
    const cutoff = new Date(Date.now() - config.webhook.eventRetentionDays * 24 * 60 * 60 * 1000);

    await prisma.webhookEvent.deleteMany({ where: { receivedAt: { lt: cutoff }, status: 'PROCESSED' } });

    const resolved = await prisma.webhookDeadLetter.findMany({
      where: { resolvedAt: { not: null }, createdAt: { lt: cutoff } },
      select: { webhookEventId: true },
    });
    if (resolved.length > 0) {
      // onDelete: Cascade on WebhookDeadLetter.webhookEvent removes the
      // dead-letter row automatically once its source event is deleted.
      await prisma.webhookEvent.deleteMany({
        where: { id: { in: resolved.map((r) => r.webhookEventId) }, status: 'DEAD_LETTERED' },
      });
    }
    recordSchedulerTick('webhook-event-cleanup', Date.now() - startedAt);
  } catch (err) {
    console.error('Webhook event cleanup sweep failed:', err);
    recordSchedulerTick('webhook-event-cleanup', Date.now() - startedAt, err instanceof Error ? err.message : String(err));
  }
};

export const startWebhookEventCleanupScheduler = (): void => {
  void runSweep();
  setInterval(() => void runSweep(), SWEEP_INTERVAL_MS);
};

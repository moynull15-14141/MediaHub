import { prisma } from '../lib/prisma';
import { getWebhookMonitor } from './whatsapp-account.service';

const avgMs = (rows: { from: Date | null; to: Date | null }[]): number | null => {
  const durations = rows
    .filter((r) => r.from && r.to)
    .map((r) => r.to!.getTime() - r.from!.getTime())
    .filter((ms) => ms >= 0);
  if (durations.length === 0) return null;
  return Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
};

// Reuses Phase 5's getWebhookMonitor for verification/last-event fields
// (never re-reads WhatsappAccount columns a second way) and adds
// event-volume + delay stats computed from CampaignQueueJob's own delivery
// timestamps - there is no separate webhook-event log table to duplicate.
export const getWebhookAnalytics = async (userId: string) => {
  const monitor = await getWebhookMonitor(userId);

  const campaigns = await prisma.campaign.findMany({ where: { userId }, select: { id: true } });
  const campaignIds = campaigns.map((c) => c.id);

  const [deliveryGroups, delayRows] = campaignIds.length
    ? await Promise.all([
        prisma.campaignQueueJob.groupBy({ by: ['deliveryStatus'], where: { campaignId: { in: campaignIds } }, _count: { _all: true } }),
        prisma.campaignQueueJob.findMany({
          where: { campaignId: { in: campaignIds }, deliveredAt: { not: null } },
          select: { completedAt: true, deliveredAt: true },
        }),
      ])
    : [[], []];

  const deliveryCount = (status: string) => deliveryGroups.find((g) => g.deliveryStatus === status)?._count._all ?? 0;
  const delivered = deliveryCount('DELIVERED') + deliveryCount('READ');
  const read = deliveryCount('READ');
  const failed = deliveryCount('FAILED');
  const receivedEvents = delivered + failed;

  const lastEvent = [monitor.webhookLastPingAt, monitor.webhookLastDeliveryAt, monitor.webhookLastReadAt, monitor.webhookLastErrorAt]
    .filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  return {
    receivedEvents,
    delivered,
    read,
    failed,
    verified: monitor.webhookVerified,
    connected: monitor.connected,
    webhookDelayMs: avgMs(delayRows.map((r) => ({ from: r.completedAt, to: r.deliveredAt }))),
    lastEvent,
    lastErrorMessage: monitor.webhookLastErrorMessage,
  };
};

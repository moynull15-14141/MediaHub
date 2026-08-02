import { prisma } from '../lib/prisma';
import { AnalyticsFilters, buildCampaignWhere } from './analytics-filters';

const round1 = (n: number): number => Math.round(n * 10) / 10;

const avgMs = (rows: { from: Date | null; to: Date | null }[]): number | null => {
  const durations = rows
    .filter((r) => r.from && r.to)
    .map((r) => r.to!.getTime() - r.from!.getTime())
    .filter((ms) => ms >= 0);
  if (durations.length === 0) return null;
  return Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
};

// Every number here is computed live from Campaign/CampaignQueueJob - nothing
// is pre-aggregated or cached, so it can never drift from the real database.
export const getOverview = async (userId: string, filters: AnalyticsFilters) => {
  const campaignWhere = buildCampaignWhere(userId, filters);

  const [
    total,
    running,
    scheduled,
    completed,
    paused,
    cancelled,
    jobStatusCounts,
    deliveryStatusCounts,
    timingRows,
  ] = await Promise.all([
    prisma.campaign.count({ where: campaignWhere }),
    prisma.campaign.count({ where: { ...campaignWhere, sendStatus: 'SENDING' } }),
    prisma.campaign.count({ where: { ...campaignWhere, sendStatus: 'SCHEDULED' } }),
    prisma.campaign.count({ where: { ...campaignWhere, sendStatus: 'COMPLETED' } }),
    prisma.campaign.count({ where: { ...campaignWhere, sendStatus: 'PAUSED' } }),
    prisma.campaign.count({ where: { ...campaignWhere, sendStatus: 'CANCELLED' } }),
    prisma.campaignQueueJob.groupBy({
      by: ['status'],
      where: { campaign: campaignWhere },
      _count: { _all: true },
    }),
    prisma.campaignQueueJob.groupBy({
      by: ['deliveryStatus'],
      where: { campaign: campaignWhere },
      _count: { _all: true },
    }),
    prisma.campaignQueueJob.findMany({
      where: { campaign: campaignWhere, startedAt: { not: null } },
      select: { queuedAt: true, startedAt: true, completedAt: true, deliveredAt: true, readAt: true },
    }),
  ]);

  const jobCount = (status: string) => jobStatusCounts.find((r) => r.status === status)?._count._all ?? 0;
  const deliveryCount = (status: string) => deliveryStatusCounts.find((r) => r.deliveryStatus === status)?._count._all ?? 0;

  const sent = jobCount('SENT');
  const failed = jobCount('FAILED');
  const pending = jobCount('PENDING') + jobCount('WAITING');
  const retrying = jobCount('RETRY');
  const delivered = deliveryCount('DELIVERED') + deliveryCount('READ');
  const read = deliveryCount('READ');

  const resolvedTerminal = sent + failed;
  const successRate = resolvedTerminal > 0 ? round1((sent / resolvedTerminal) * 100) : 0;
  const deliveryRate = sent > 0 ? round1((delivered / sent) * 100) : 0;
  const readRate = sent > 0 ? round1((read / sent) * 100) : 0;

  const avgQueueTimeMs = avgMs(timingRows.map((r) => ({ from: r.queuedAt, to: r.startedAt })));
  const avgDeliveryTimeMs = avgMs(timingRows.map((r) => ({ from: r.completedAt, to: r.deliveredAt })));
  const avgReadTimeMs = avgMs(timingRows.map((r) => ({ from: r.completedAt, to: r.readAt })));

  return {
    totalCampaigns: total,
    running,
    scheduled,
    completed,
    paused,
    cancelled,
    delivered,
    read,
    failed,
    pending,
    retrying,
    successRate,
    readRate,
    deliveryRate,
    avgDeliveryTimeMs,
    avgReadTimeMs,
    avgQueueTimeMs,
  };
};

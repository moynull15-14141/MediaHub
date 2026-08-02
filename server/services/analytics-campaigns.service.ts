import { prisma } from '../lib/prisma';
import { AnalyticsFilters, buildCampaignWhere } from './analytics-filters';

export class AnalyticsError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const msBetween = (from: Date | null, to: Date | null): number | null => {
  if (!from || !to) return null;
  const ms = to.getTime() - from.getTime();
  return ms >= 0 ? ms : null;
};

export interface ListCampaignAnalyticsOptions extends AnalyticsFilters {
  page?: number;
  pageSize?: number;
}

// Per-campaign metrics for the Campaign Analytics table. Recipients/
// delivered/read/failed/skipped/retryCount are all derived from
// CampaignQueueJob + CampaignSendLog - nothing is stored redundantly on
// Campaign itself.
export const listCampaignAnalytics = async (userId: string, options: ListCampaignAnalyticsOptions) => {
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 25));
  const where = buildCampaignWhere(userId, options);

  const [campaigns, total] = await Promise.all([
    prisma.campaign.findMany({
      where,
      select: {
        id: true,
        name: true,
        sendStatus: true,
        queueStartedAt: true,
        queueCompletedAt: true,
        createdAt: true,
        _count: { select: { recipients: true } },
      },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.campaign.count({ where }),
  ]);

  const campaignIds = campaigns.map((c) => c.id);
  const [statusGroups, deliveryGroups, retryGroups] = campaignIds.length
    ? await Promise.all([
        prisma.campaignQueueJob.groupBy({ by: ['campaignId', 'status'], where: { campaignId: { in: campaignIds } }, _count: { _all: true } }),
        prisma.campaignQueueJob.groupBy({ by: ['campaignId', 'deliveryStatus'], where: { campaignId: { in: campaignIds } }, _count: { _all: true } }),
        prisma.campaignSendLog.groupBy({ by: ['campaignId'], where: { campaignId: { in: campaignIds }, status: 'RETRY' }, _count: { _all: true } }),
      ])
    : [[], [], []];

  const results = campaigns.map((c) => {
    const jobCount = (status: string) => statusGroups.find((g) => g.campaignId === c.id && g.status === status)?._count._all ?? 0;
    const deliveryCount = (status: string) => deliveryGroups.find((g) => g.campaignId === c.id && g.deliveryStatus === status)?._count._all ?? 0;
    const retryCount = retryGroups.find((g) => g.campaignId === c.id)?._count._all ?? 0;

    const sent = jobCount('SENT');
    const failed = jobCount('FAILED');
    const skipped = jobCount('SKIPPED');
    const delivered = deliveryCount('DELIVERED') + deliveryCount('READ');
    const read = deliveryCount('READ');

    const durationMs = msBetween(c.queueStartedAt, c.queueCompletedAt ?? (c.sendStatus === 'SENDING' ? new Date() : null));
    const durationMinutes = durationMs !== null ? durationMs / 60000 : null;
    const avgSendSpeedPerMinute = durationMinutes && durationMinutes > 0 ? Math.round((sent / durationMinutes) * 10) / 10 : null;

    return {
      id: c.id,
      name: c.name,
      sendStatus: c.sendStatus,
      recipients: c._count.recipients,
      delivered,
      read,
      failed,
      skipped,
      retryCount,
      startTime: c.queueStartedAt,
      finishTime: c.queueCompletedAt,
      durationMs,
      avgSendSpeedPerMinute,
    };
  });

  return { campaigns: results, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

// Single-campaign detail: status breakdown (donut) + a sent/delivered/read/
// failed timeline bucketed by hour (bucketing by hour keeps the chart legible
// for both a 20-minute test blast and a multi-day campaign).
export const getCampaignAnalyticsDetail = async (userId: string, campaignId: string) => {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, name: true, sendStatus: true, queueStartedAt: true, queueCompletedAt: true, userId: true, _count: { select: { recipients: true } } },
  });
  if (!campaign || campaign.userId !== userId) throw new AnalyticsError('Campaign not found', 404);

  const [statusGroups, deliveryGroups, retryCount, jobs, timingRows] = await Promise.all([
    prisma.campaignQueueJob.groupBy({ by: ['status'], where: { campaignId }, _count: { _all: true } }),
    prisma.campaignQueueJob.groupBy({ by: ['deliveryStatus'], where: { campaignId }, _count: { _all: true } }),
    prisma.campaignSendLog.count({ where: { campaignId, status: 'RETRY' } }),
    prisma.campaignQueueJob.findMany({
      where: { campaignId },
      select: { completedAt: true, deliveredAt: true, readAt: true, failedAt: true },
    }),
    prisma.campaignQueueJob.findMany({
      where: { campaignId, startedAt: { not: null } },
      select: { queuedAt: true, startedAt: true },
    }),
  ]);

  const jobCount = (status: string) => statusGroups.find((g) => g.status === status)?._count._all ?? 0;
  const deliveryCount = (status: string) => deliveryGroups.find((g) => g.deliveryStatus === status)?._count._all ?? 0;

  const bucketByHour = (dates: Date[]): { bucket: string; count: number }[] => {
    const buckets = new Map<string, number>();
    for (const d of dates) {
      const key = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).toISOString();
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, count]) => ({ bucket, count }));
  };

  const timeline = {
    sent: bucketByHour(jobs.filter((j) => j.completedAt).map((j) => j.completedAt as Date)),
    delivered: bucketByHour(jobs.filter((j) => j.deliveredAt).map((j) => j.deliveredAt as Date)),
    read: bucketByHour(jobs.filter((j) => j.readAt).map((j) => j.readAt as Date)),
    failed: bucketByHour(jobs.filter((j) => j.failedAt).map((j) => j.failedAt as Date)),
  };

  const durationMs = msBetween(campaign.queueStartedAt, campaign.queueCompletedAt ?? (campaign.sendStatus === 'SENDING' ? new Date() : null));
  const avgQueueTimeMs = (() => {
    const durations = timingRows.filter((r) => r.startedAt).map((r) => r.startedAt!.getTime() - r.queuedAt.getTime()).filter((ms) => ms >= 0);
    return durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
  })();

  const sent = jobCount('SENT');
  const durationMinutes = durationMs !== null ? durationMs / 60000 : null;

  return {
    id: campaign.id,
    name: campaign.name,
    sendStatus: campaign.sendStatus,
    recipients: campaign._count.recipients,
    delivered: deliveryCount('DELIVERED') + deliveryCount('READ'),
    read: deliveryCount('READ'),
    failed: jobCount('FAILED'),
    skipped: jobCount('SKIPPED'),
    pending: jobCount('PENDING') + jobCount('WAITING'),
    retrying: jobCount('RETRY'),
    retryCount,
    startTime: campaign.queueStartedAt,
    finishTime: campaign.queueCompletedAt,
    durationMs,
    avgSendSpeedPerMinute: durationMinutes && durationMinutes > 0 ? Math.round((sent / durationMinutes) * 10) / 10 : null,
    avgQueueTimeMs,
    statusBreakdown: statusGroups.map((g) => ({ status: g.status, count: g._count._all })),
    timeline,
  };
};

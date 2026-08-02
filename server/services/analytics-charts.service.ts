import { prisma } from '../lib/prisma';
import { AnalyticsFilters, buildCampaignWhere } from './analytics-filters';

export class ChartError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export type ChartGranularity = 'daily' | 'weekly' | 'monthly';
export type ChartMetric =
  | 'campaignTrend'
  | 'deliveryTrend'
  | 'readTrend'
  | 'failureTrend'
  | 'queueTrend'
  | 'templateUsage'
  | 'contactGrowth';

const METRICS: ChartMetric[] = ['campaignTrend', 'deliveryTrend', 'readTrend', 'failureTrend', 'queueTrend', 'templateUsage', 'contactGrowth'];
export const isValidMetric = (m: unknown): m is ChartMetric => typeof m === 'string' && METRICS.includes(m as ChartMetric);

const weekKey = (d: Date): string => {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
};
const monthKey = (d: Date): string => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

const keyFnFor = (granularity: ChartGranularity) =>
  granularity === 'daily' ? dayKey : granularity === 'weekly' ? weekKey : monthKey;

const bucket = (dates: Date[], granularity: ChartGranularity): { period: string; value: number }[] => {
  const keyFn = keyFnFor(granularity);
  const buckets = new Map<string, number>();
  for (const d of dates) buckets.set(keyFn(d), (buckets.get(keyFn(d)) ?? 0) + 1);
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, value]) => ({ period, value }));
};

const DEFAULT_DAYS = 30;

// Every chart is a plain COUNT(*) ... GROUP BY period over real rows already
// used elsewhere in Phase 6 (Campaign/CampaignQueueJob/Contact) - no
// pre-aggregated chart-data table, so a chart can never disagree with the
// stat cards above it.
export const getChartData = async (
  userId: string,
  metric: ChartMetric,
  granularity: ChartGranularity,
  filters: AnalyticsFilters,
): Promise<{ period: string; value: number }[]> => {
  const from = filters.dateFrom ?? new Date(Date.now() - DEFAULT_DAYS * 24 * 60 * 60 * 1000);
  const to = filters.dateTo ?? new Date();
  const campaignWhere = buildCampaignWhere(userId, { ...filters, dateFrom: undefined, dateTo: undefined });

  switch (metric) {
    case 'campaignTrend': {
      const rows = await prisma.campaign.findMany({ where: { ...campaignWhere, createdAt: { gte: from, lte: to } }, select: { createdAt: true } });
      return bucket(rows.map((r) => r.createdAt), granularity);
    }
    case 'deliveryTrend': {
      const rows = await prisma.campaignQueueJob.findMany({
        where: { campaign: campaignWhere, deliveredAt: { gte: from, lte: to } },
        select: { deliveredAt: true },
      });
      return bucket(rows.map((r) => r.deliveredAt as Date), granularity);
    }
    case 'readTrend': {
      const rows = await prisma.campaignQueueJob.findMany({
        where: { campaign: campaignWhere, readAt: { gte: from, lte: to } },
        select: { readAt: true },
      });
      return bucket(rows.map((r) => r.readAt as Date), granularity);
    }
    case 'failureTrend': {
      const rows = await prisma.campaignQueueJob.findMany({
        where: { campaign: campaignWhere, failedAt: { gte: from, lte: to } },
        select: { failedAt: true },
      });
      return bucket(rows.map((r) => r.failedAt as Date), granularity);
    }
    case 'queueTrend': {
      const rows = await prisma.campaignQueueJob.findMany({
        where: { campaign: campaignWhere, queuedAt: { gte: from, lte: to } },
        select: { queuedAt: true },
      });
      return bucket(rows.map((r) => r.queuedAt), granularity);
    }
    case 'templateUsage': {
      const rows = await prisma.campaign.findMany({
        where: { ...campaignWhere, templateId: { not: null }, createdAt: { gte: from, lte: to } },
        select: { createdAt: true },
      });
      return bucket(rows.map((r) => r.createdAt), granularity);
    }
    case 'contactGrowth': {
      const rows = await prisma.contact.findMany({ where: { userId, createdAt: { gte: from, lte: to } }, select: { createdAt: true } });
      return bucket(rows.map((r) => r.createdAt), granularity);
    }
    default:
      throw new ChartError(`Unknown chart metric: ${metric}`);
  }
};

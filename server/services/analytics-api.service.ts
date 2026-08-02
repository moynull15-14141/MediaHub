import { prisma } from '../lib/prisma';

// Meta API usage trends. Reuses the exact same CampaignSendLog rows Phase 5's
// api-health.service.ts already aggregates for "today" - this module just
// extends the time window and adds daily/weekly/monthly buckets, so there is
// no second source of truth for what counts as an API request.
const DEFAULT_DAYS = 90;

const weekKey = (d: Date): string => {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1); // Monday of that week
  return date.toISOString().slice(0, 10);
};
const monthKey = (d: Date): string => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

const bucketBy = (dates: Date[], keyFn: (d: Date) => string): { period: string; count: number }[] => {
  const buckets = new Map<string, number>();
  for (const d of dates) buckets.set(keyFn(d), (buckets.get(keyFn(d)) ?? 0) + 1);
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, count]) => ({ period, count }));
};

export const getApiAnalytics = async (userId: string, dateFrom?: Date, dateTo?: Date) => {
  const from = dateFrom ?? new Date(Date.now() - DEFAULT_DAYS * 24 * 60 * 60 * 1000);
  const to = dateTo ?? new Date();

  const campaigns = await prisma.campaign.findMany({ where: { userId }, select: { id: true } });
  const campaignIds = campaigns.map((c) => c.id);
  if (campaignIds.length === 0) {
    return {
      totalRequests: 0,
      rateLimited429: 0,
      serverError5xx: 0,
      timeoutCount: 0,
      averageResponseTimeMs: null,
      dailyUsage: [],
      weeklyUsage: [],
      monthlyUsage: [],
    };
  }

  const where = { campaignId: { in: campaignIds }, createdAt: { gte: from, lte: to } };
  const [total, rateLimited, serverErrors, timeouts, avgAgg, logs] = await Promise.all([
    prisma.campaignSendLog.count({ where }),
    prisma.campaignSendLog.count({ where: { ...where, errorCode: 'RATE_LIMIT' } }),
    prisma.campaignSendLog.count({ where: { ...where, errorCode: 'SERVER_ERROR' } }),
    prisma.campaignSendLog.count({ where: { ...where, errorCode: 'NETWORK' } }),
    prisma.campaignSendLog.aggregate({ where, _avg: { durationMs: true } }),
    prisma.campaignSendLog.findMany({ where, select: { createdAt: true } }),
  ]);

  const dates = logs.map((l) => l.createdAt);
  return {
    totalRequests: total,
    rateLimited429: rateLimited,
    serverError5xx: serverErrors,
    timeoutCount: timeouts,
    averageResponseTimeMs: avgAgg._avg.durationMs !== null ? Math.round(avgAgg._avg.durationMs) : null,
    dailyUsage: bucketBy(dates, dayKey),
    weeklyUsage: bucketBy(dates, weekKey),
    monthlyUsage: bucketBy(dates, monthKey),
  };
};

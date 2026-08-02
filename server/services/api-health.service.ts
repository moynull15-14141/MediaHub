import { prisma } from '../lib/prisma';

// Reuses the existing CampaignSendLog table (Phase 4) rather than adding a
// second API-call logging table - every Meta send attempt is already
// recorded there with a duration/status/errorCode.
export const getApiHealth = async (userId: string) => {
  const campaigns = await prisma.campaign.findMany({ where: { userId }, select: { id: true } });
  const campaignIds = campaigns.map((c) => c.id);

  if (campaignIds.length === 0) {
    return {
      totalRequestsToday: 0,
      successPercent: 100,
      rateLimitedCount: 0,
      serverErrorCount: 0,
      averageResponseTimeMs: null,
      lastFailure: null,
    };
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const where = { campaignId: { in: campaignIds }, createdAt: { gte: startOfDay } };

  const [total, sent, rateLimited, serverErrors, avgAgg, lastFailure] = await Promise.all([
    prisma.campaignSendLog.count({ where }),
    prisma.campaignSendLog.count({ where: { ...where, status: 'SENT' } }),
    prisma.campaignSendLog.count({ where: { ...where, errorCode: 'RATE_LIMIT' } }),
    prisma.campaignSendLog.count({ where: { ...where, errorCode: 'SERVER_ERROR' } }),
    prisma.campaignSendLog.aggregate({ where, _avg: { durationMs: true } }),
    prisma.campaignSendLog.findFirst({
      where: { campaignId: { in: campaignIds }, status: { in: ['FAILED', 'RETRY'] } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const successPercent = total > 0 ? Math.round((sent / total) * 1000) / 10 : 100;

  return {
    totalRequestsToday: total,
    successPercent,
    rateLimitedCount: rateLimited,
    serverErrorCount: serverErrors,
    averageResponseTimeMs: avgAgg._avg.durationMs !== null ? Math.round(avgAgg._avg.durationMs) : null,
    lastFailure: lastFailure
      ? { createdAt: lastFailure.createdAt, errorCode: lastFailure.errorCode, errorMessage: lastFailure.errorMessage }
      : null,
  };
};

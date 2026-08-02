import { prisma } from '../lib/prisma';

const round1 = (n: number): number => Math.round(n * 10) / 10;

const bucketByDay = (dates: Date[]): { date: string; count: number }[] => {
  const buckets = new Map<string, number>();
  for (const d of dates) {
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
};

// Usage/success/read/failure are derived from Campaign.templateId (Phase 6
// addition) joined against CampaignQueueJob - a template itself stores no
// send statistics, so nothing here can go stale relative to real sends.
// Average CTR is reported as null (not 0, not fabricated) since WhatsApp
// text messages carry no click-tracking data today; the field exists so a
// future link-tracking feature can populate it without an API shape change.
export const getTemplateAnalytics = async (userId: string) => {
  const [templates, campaignsWithTemplate] = await Promise.all([
    prisma.messageTemplate.findMany({ where: { userId }, select: { id: true, name: true, category: true, isFavorite: true } }),
    prisma.campaign.findMany({
      where: { userId, templateId: { not: null } },
      select: { id: true, templateId: true, createdAt: true },
    }),
  ]);

  const campaignIds = campaignsWithTemplate.map((c) => c.id);
  const campaignToTemplate = new Map(campaignsWithTemplate.map((c) => [c.id, c.templateId as string]));

  const statusGroups = campaignIds.length
    ? await prisma.campaignQueueJob.groupBy({ by: ['campaignId', 'status'], where: { campaignId: { in: campaignIds } }, _count: { _all: true } })
    : [];
  const deliveryGroups = campaignIds.length
    ? await prisma.campaignQueueJob.groupBy({ by: ['campaignId', 'deliveryStatus'], where: { campaignId: { in: campaignIds } }, _count: { _all: true } })
    : [];

  interface Agg { sent: number; failed: number; delivered: number; read: number; usageCount: number }
  const perTemplate = new Map<string, Agg>();
  const ensure = (id: string): Agg => {
    let agg = perTemplate.get(id);
    if (!agg) {
      agg = { sent: 0, failed: 0, delivered: 0, read: 0, usageCount: 0 };
      perTemplate.set(id, agg);
    }
    return agg;
  };

  for (const c of campaignsWithTemplate) ensure(c.templateId as string).usageCount += 1;
  for (const g of statusGroups) {
    const templateId = campaignToTemplate.get(g.campaignId);
    if (!templateId) continue;
    const agg = ensure(templateId);
    if (g.status === 'SENT') agg.sent += g._count._all;
    if (g.status === 'FAILED') agg.failed += g._count._all;
  }
  for (const g of deliveryGroups) {
    const templateId = campaignToTemplate.get(g.campaignId);
    if (!templateId) continue;
    const agg = ensure(templateId);
    if (g.deliveryStatus === 'DELIVERED' || g.deliveryStatus === 'READ') agg.delivered += g._count._all;
    if (g.deliveryStatus === 'READ') agg.read += g._count._all;
  }

  const results = templates.map((t) => {
    const agg = perTemplate.get(t.id) ?? { sent: 0, failed: 0, delivered: 0, read: 0, usageCount: 0 };
    const resolvedTerminal = agg.sent + agg.failed;
    return {
      id: t.id,
      name: t.name,
      category: t.category,
      isFavorite: t.isFavorite,
      usageCount: agg.usageCount,
      successPercent: resolvedTerminal > 0 ? round1((agg.sent / resolvedTerminal) * 100) : 0,
      readPercent: agg.sent > 0 ? round1((agg.read / agg.sent) * 100) : 0,
      failurePercent: resolvedTerminal > 0 ? round1((agg.failed / resolvedTerminal) * 100) : 0,
      ctr: null as number | null,
    };
  });

  results.sort((a, b) => b.usageCount - a.usageCount);

  return {
    templates: results,
    mostUsed: results.slice(0, 10),
    favorites: results.filter((r) => r.isFavorite),
    usageTrend: bucketByDay(campaignsWithTemplate.map((c) => c.createdAt)),
  };
};

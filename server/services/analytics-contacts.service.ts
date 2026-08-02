import { prisma } from '../lib/prisma';

const DEFAULT_GROWTH_DAYS = 90;

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

// Blocked/Invalid/Subscribed/Unsubscribed reuse the Phase 5 BlacklistedNumber
// table (cross-referenced by phone number) rather than inventing a second
// status field on Contact - "Subscribed" simply means "not on the blacklist".
export const getContactAnalytics = async (userId: string, dateFrom?: Date, dateTo?: Date) => {
  const growthFrom = dateFrom ?? new Date(Date.now() - DEFAULT_GROWTH_DAYS * 24 * 60 * 60 * 1000);
  const growthTo = dateTo ?? new Date();

  const [
    totalContacts,
    activeContacts,
    inactiveContacts,
    blacklistByReason,
    blacklistedPhones,
    topLabels,
    topGroups,
    growthRows,
    importHistory,
  ] = await Promise.all([
    prisma.contact.count({ where: { userId } }),
    prisma.contact.count({ where: { userId, status: 'ACTIVE' } }),
    prisma.contact.count({ where: { userId, status: 'INACTIVE' } }),
    prisma.blacklistedNumber.groupBy({ by: ['reason'], where: { userId }, _count: { _all: true } }),
    prisma.blacklistedNumber.findMany({ where: { userId }, select: { phoneNumber: true } }),
    prisma.label.findMany({
      where: { userId },
      include: { _count: { select: { contacts: true } } },
      orderBy: { contacts: { _count: 'desc' } },
      take: 5,
    }),
    prisma.group.findMany({
      where: { userId },
      include: { _count: { select: { contacts: true } } },
      orderBy: { contacts: { _count: 'desc' } },
      take: 5,
    }),
    prisma.contact.findMany({
      where: { userId, createdAt: { gte: growthFrom, lte: growthTo } },
      select: { createdAt: true },
    }),
    prisma.contactImportBatch.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);

  const reasonCount = (reason: string) => blacklistByReason.find((r) => r.reason === reason)?._count._all ?? 0;
  const blacklistedSet = new Set(blacklistedPhones.map((b) => b.phoneNumber));
  const subscribedContacts = await prisma.contact.count({
    where: { userId, phoneNumber: blacklistedSet.size ? { notIn: Array.from(blacklistedSet) } : undefined },
  });

  return {
    totalContacts,
    activeContacts,
    inactiveContacts,
    blockedContacts: reasonCount('BLOCKED'),
    invalidContacts: reasonCount('INVALID'),
    subscribedContacts,
    unsubscribedContacts: reasonCount('UNSUBSCRIBED'),
    topLabels: topLabels.map((l) => ({ id: l.id, name: l.name, color: l.color, contactCount: l._count.contacts })),
    topGroups: topGroups.map((g) => ({ id: g.id, name: g.name, contactCount: g._count.contacts })),
    growth: bucketByDay(growthRows.map((r) => r.createdAt)),
    importHistory: importHistory.map((b) => ({
      id: b.id,
      filename: b.filename,
      source: b.source,
      totalRows: b.totalRows,
      importedCount: b.importedCount,
      duplicateCount: b.duplicateCount,
      invalidCount: b.invalidCount,
      skippedCount: b.skippedCount,
      createdAt: b.createdAt,
    })),
  };
};

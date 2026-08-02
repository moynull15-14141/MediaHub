import { prisma } from '../lib/prisma';
import { getWorkerHeartbeat } from './campaign-queue-worker.service';

const round1 = (n: number): number => Math.round(n * 10) / 10;

const avgMs = (rows: { from: Date | null; to: Date | null }[]): number | null => {
  const durations = rows
    .filter((r) => r.from && r.to)
    .map((r) => r.to!.getTime() - r.from!.getTime())
    .filter((ms) => ms >= 0);
  if (durations.length === 0) return null;
  return Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
};

// A live snapshot of this account's queue right now - not date-filtered like
// the rest of Phase 6, since "current queue size" is meaningless as a
// historical range. Reuses the exact same worker heartbeat System Health
// (Phase 5) already exposes, rather than tracking a second liveness signal.
export const getQueueAnalytics = async (userId: string, campaignId?: string) => {
  const campaignScope = campaignId ? { campaignId } : { campaign: { userId } };

  const [statusGroups, account, waitRows, processingRows] = await Promise.all([
    prisma.campaignQueueJob.groupBy({ by: ['status'], where: campaignScope, _count: { _all: true } }),
    prisma.whatsappAccount.findUnique({ where: { userId }, select: { maxConcurrentJobs: true } }),
    prisma.campaignQueueJob.findMany({
      where: { ...campaignScope, startedAt: { not: null } },
      select: { queuedAt: true, startedAt: true },
    }),
    prisma.campaignQueueJob.findMany({
      where: { ...campaignScope, startedAt: { not: null }, OR: [{ status: 'SENT' }, { status: 'FAILED' }] },
      select: { startedAt: true, completedAt: true, failedAt: true },
    }),
  ]);

  const jobCount = (status: string) => statusGroups.find((g) => g.status === status)?._count._all ?? 0;

  const waiting = jobCount('PENDING') + jobCount('WAITING');
  const running = jobCount('SENDING');
  const completed = jobCount('SENT');
  const retrying = jobCount('RETRY');
  const dead = jobCount('FAILED');
  const currentQueueSize = waiting + running + retrying;

  const maxConcurrentJobs = account?.maxConcurrentJobs ?? 1;
  const workerUtilizationPercent = maxConcurrentJobs > 0 ? round1((running / maxConcurrentJobs) * 100) : 0;

  return {
    currentQueueSize,
    waiting,
    running,
    completed,
    retrying,
    dead,
    avgWaitTimeMs: avgMs(waitRows.map((r) => ({ from: r.queuedAt, to: r.startedAt }))),
    avgProcessingTimeMs: avgMs(processingRows.map((r) => ({ from: r.startedAt, to: r.completedAt ?? r.failedAt }))),
    workerUtilizationPercent,
    maxConcurrentJobs,
    workerHeartbeat: getWorkerHeartbeat(),
  };
};

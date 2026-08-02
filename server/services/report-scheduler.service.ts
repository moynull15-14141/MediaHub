import { prisma } from '../lib/prisma';
import { generateReport, computeNextRunAt } from './scheduled-report.service';

// Mirrors the existing campaign-queue-worker.service.ts polling convention
// (setInterval + a re-entrancy guard) rather than introducing a second
// scheduling mechanism (no cron package added).
const POLL_INTERVAL_MS = 60_000;

let timer: NodeJS.Timeout | null = null;
let tickRunning = false;
let lastTickAt: Date | null = null;

// Consumed by diagnostics.service.ts (Phase A.4, Part 2) - mirrors
// getWorkerHeartbeat() in campaign-queue-worker.service.ts.
export const getSchedulerHeartbeat = (): { running: boolean; lastTickAt: Date | null } => ({
  running: timer !== null,
  lastTickAt,
});

const runDueReports = async (): Promise<void> => {
  const due = await prisma.scheduledReport.findMany({
    where: { enabled: true, nextRunAt: { lte: new Date() } },
  });

  for (const report of due) {
    try {
      await generateReport(report.workspaceId, report.userId, {
        name: report.name,
        dataset: report.dataset as any,
        format: report.format as any,
        filters: (report.filters as any) ?? {},
        scheduledReportId: report.id,
      });
      const now = new Date();
      await prisma.scheduledReport.update({
        where: { id: report.id },
        data: { lastRunAt: now, nextRunAt: computeNextRunAt(report.frequency, now) },
      });
    } catch (err) {
      console.error(`Scheduled report ${report.id} failed to generate:`, err);
      // Push nextRunAt forward by the poll interval so a persistent failure
      // (e.g. R2 outage) doesn't spin-retry every tick forever.
      await prisma.scheduledReport.update({
        where: { id: report.id },
        data: { nextRunAt: new Date(Date.now() + POLL_INTERVAL_MS) },
      }).catch(() => {});
    }
  }
};

const tick = async (): Promise<void> => {
  if (tickRunning) return;
  tickRunning = true;
  try {
    await runDueReports();
    lastTickAt = new Date();
  } catch (err) {
    console.error('Report scheduler tick error:', err);
  } finally {
    tickRunning = false;
  }
};

export const startReportScheduler = (): void => {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);
  console.log('Scheduled report worker started');
};

export const stopReportScheduler = async (): Promise<void> => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  while (tickRunning) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

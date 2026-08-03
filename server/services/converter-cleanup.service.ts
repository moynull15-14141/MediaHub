import fs from 'fs';
import { prisma } from '../lib/prisma';
import { getJobDir } from '../lib/converter-paths';
import { deleteFromR2 } from '../lib/r2';
import { recordSchedulerTick } from '../lib/scheduler-registry';

const STALE_CONVERTING_MINUTES = Number(process.env.CONVERTER_STALE_MINUTES) || 30;
const ABANDONED_QUEUED_HOURS = Number(process.env.CONVERTER_ABANDONED_HOURS) || 6;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const removeJobDir = async (jobId: string) => {
  await fs.promises.rm(getJobDir(jobId), { recursive: true, force: true });
};

const sweepExpiredCompleted = async () => {
  const expired = await prisma.conversionJob.findMany({
    where: { status: 'COMPLETED', downloadExpiresAt: { lt: new Date() } },
  });
  for (const job of expired) {
    await removeJobDir(job.id);
    await deleteFromR2([job.inputPath, job.outputPath].filter(Boolean) as string[]);
    await prisma.conversionJob.delete({ where: { id: job.id } }).catch(() => {});
  }
};

const sweepStaleConverting = async () => {
  const staleBefore = new Date(Date.now() - STALE_CONVERTING_MINUTES * 60 * 1000);
  const stale = await prisma.conversionJob.findMany({
    where: { status: 'CONVERTING', updatedAt: { lt: staleBefore } },
  });
  for (const job of stale) {
    await removeJobDir(job.id);
    await deleteFromR2([job.inputPath, job.outputPath].filter(Boolean) as string[]);
    await prisma.conversionJob
      .update({
        where: { id: job.id },
        data: { status: 'FAILED', errorMessage: 'Conversion interrupted (server restarted)' },
      })
      .catch(() => {});
  }
};

const sweepAbandonedUploads = async () => {
  const abandonedBefore = new Date(Date.now() - ABANDONED_QUEUED_HOURS * 60 * 60 * 1000);
  const abandoned = await prisma.conversionJob.findMany({
    where: { status: 'QUEUED', startedAt: null, createdAt: { lt: abandonedBefore } },
  });
  for (const job of abandoned) {
    await removeJobDir(job.id);
    await deleteFromR2([job.inputPath, job.outputPath].filter(Boolean) as string[]);
    await prisma.conversionJob.delete({ where: { id: job.id } }).catch(() => {});
  }
};

const runSweep = async () => {
  const startedAt = Date.now();
  try {
    await sweepExpiredCompleted();
    await sweepStaleConverting();
    await sweepAbandonedUploads();
    recordSchedulerTick('converter-cleanup', Date.now() - startedAt);
  } catch (err) {
    console.error('Converter cleanup sweep failed:', err);
    recordSchedulerTick('converter-cleanup', Date.now() - startedAt, err instanceof Error ? err.message : String(err));
  }
};

export const startConverterCleanupScheduler = () => {
  void runSweep();
  setInterval(() => void runSweep(), SWEEP_INTERVAL_MS);
};

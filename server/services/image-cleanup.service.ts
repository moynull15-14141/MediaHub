import fs from 'fs';
import { prisma } from '../lib/prisma';
import { getImageJobDir } from '../lib/image-paths';
import { deleteFromR2 } from '../lib/r2';
import { recordSchedulerTick } from '../lib/scheduler-registry';

const ABANDONED_QUEUED_HOURS = Number(process.env.IMAGE_ABANDONED_HOURS) || 6;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const removeJobDir = async (jobId: string) => {
  await fs.promises.rm(getImageJobDir(jobId), { recursive: true, force: true });
};

const sweepExpiredCompleted = async () => {
  const expired = await prisma.imageJob.findMany({
    where: { status: 'COMPLETED', downloadExpiresAt: { lt: new Date() } },
  });
  for (const job of expired) {
    await removeJobDir(job.id);
    await deleteFromR2([job.inputPath, job.outputPath].filter(Boolean) as string[]);
    await prisma.imageJob.delete({ where: { id: job.id } }).catch(() => {});
  }
};

const sweepAbandonedUploads = async () => {
  const abandonedBefore = new Date(Date.now() - ABANDONED_QUEUED_HOURS * 60 * 60 * 1000);
  const abandoned = await prisma.imageJob.findMany({
    where: { status: 'QUEUED', createdAt: { lt: abandonedBefore } },
  });
  for (const job of abandoned) {
    await removeJobDir(job.id);
    await deleteFromR2([job.inputPath, job.outputPath].filter(Boolean) as string[]);
    await prisma.imageJob.delete({ where: { id: job.id } }).catch(() => {});
  }
};

const sweepFailed = async () => {
  const failedBefore = new Date(Date.now() - ABANDONED_QUEUED_HOURS * 60 * 60 * 1000);
  const failed = await prisma.imageJob.findMany({
    where: { status: 'FAILED', updatedAt: { lt: failedBefore } },
  });
  for (const job of failed) {
    await removeJobDir(job.id);
    await deleteFromR2([job.inputPath, job.outputPath].filter(Boolean) as string[]);
    await prisma.imageJob.delete({ where: { id: job.id } }).catch(() => {});
  }
};

const runSweep = async () => {
  const startedAt = Date.now();
  try {
    await sweepExpiredCompleted();
    await sweepAbandonedUploads();
    await sweepFailed();
    recordSchedulerTick('image-cleanup', Date.now() - startedAt);
  } catch (err) {
    console.error('Image cleanup sweep failed:', err);
    recordSchedulerTick('image-cleanup', Date.now() - startedAt, err instanceof Error ? err.message : String(err));
  }
};

export const startImageCleanupScheduler = () => {
  void runSweep();
  setInterval(() => void runSweep(), SWEEP_INTERVAL_MS);
};

import fs from 'fs';
import { prisma } from '../lib/prisma';
import { getPdfJobDir } from '../lib/pdf-paths';
import { deleteFromR2 } from '../lib/r2';
import { recordSchedulerTick } from '../lib/scheduler-registry';

const STALE_PROCESSING_MINUTES = Number(process.env.PDF_STALE_MINUTES) || 30;
const ABANDONED_QUEUED_HOURS = Number(process.env.PDF_ABANDONED_HOURS) || 6;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const removeJobDir = async (jobId: string) => {
  await fs.promises.rm(getPdfJobDir(jobId), { recursive: true, force: true });
};

const cleanupR2ForJob = (job: { inputPaths: string[]; thumbnailPaths: string[]; outputPath: string | null }) =>
  deleteFromR2([...job.inputPaths, ...job.thumbnailPaths, job.outputPath].filter(Boolean) as string[]);

const sweepExpiredCompleted = async () => {
  const expired = await prisma.pdfJob.findMany({
    where: { status: 'COMPLETED', downloadExpiresAt: { lt: new Date() } },
  });
  for (const job of expired) {
    await removeJobDir(job.id);
    await cleanupR2ForJob(job);
    await prisma.pdfJob.delete({ where: { id: job.id } }).catch(() => {});
  }
};

const sweepStaleProcessing = async () => {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MINUTES * 60 * 1000);
  const stale = await prisma.pdfJob.findMany({
    where: { status: 'PROCESSING', updatedAt: { lt: staleBefore } },
  });
  for (const job of stale) {
    await removeJobDir(job.id);
    await prisma.pdfJob
      .update({ where: { id: job.id }, data: { status: 'FAILED', errorMessage: 'Processing interrupted (server restarted)' } })
      .catch(() => {});
  }
};

const sweepAbandonedUploads = async () => {
  const abandonedBefore = new Date(Date.now() - ABANDONED_QUEUED_HOURS * 60 * 60 * 1000);
  const abandoned = await prisma.pdfJob.findMany({
    where: { status: 'QUEUED', createdAt: { lt: abandonedBefore } },
  });
  for (const job of abandoned) {
    await removeJobDir(job.id);
    await cleanupR2ForJob(job);
    await prisma.pdfJob.delete({ where: { id: job.id } }).catch(() => {});
  }
};

const sweepFailed = async () => {
  const failedBefore = new Date(Date.now() - ABANDONED_QUEUED_HOURS * 60 * 60 * 1000);
  const failed = await prisma.pdfJob.findMany({
    where: { status: 'FAILED', updatedAt: { lt: failedBefore } },
  });
  for (const job of failed) {
    await removeJobDir(job.id);
    await cleanupR2ForJob(job);
    await prisma.pdfJob.delete({ where: { id: job.id } }).catch(() => {});
  }
};

const runSweep = async () => {
  const startedAt = Date.now();
  try {
    await sweepExpiredCompleted();
    await sweepStaleProcessing();
    await sweepAbandonedUploads();
    await sweepFailed();
    recordSchedulerTick('pdf-cleanup', Date.now() - startedAt);
  } catch (err) {
    console.error('PDF cleanup sweep failed:', err);
    recordSchedulerTick('pdf-cleanup', Date.now() - startedAt, err instanceof Error ? err.message : String(err));
  }
};

export const startPdfCleanupScheduler = () => {
  void runSweep();
  setInterval(() => void runSweep(), SWEEP_INTERVAL_MS);
};

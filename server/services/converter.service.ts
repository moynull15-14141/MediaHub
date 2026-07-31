import fs from 'fs';
import { prisma } from '../lib/prisma';
import { getJobDir, getInputDir, getOutputDir, getInputPath, getOutputPath, getInputKey, getOutputKey } from '../lib/converter-paths';
import { uploadFileToR2, downloadFileFromR2, deleteFromR2, getPresignedDownloadUrl } from '../lib/r2';
import {
  probeVideo,
  buildFfmpegArgs,
  detectAvailableEncoders,
  runFfmpegWithProgress,
  killGracefully,
  ConversionOptions,
  AUDIO_EXTRACT_EXTENSION,
  OutputFormat,
  Quality,
  VideoCodec,
  AudioCodec,
  AudioMode,
  EncodePreset,
} from './ffmpeg.service';
import { conversionQueue } from './conversion-queue.service';
import { RequestOwner } from '../lib/auth-helpers';

const DOWNLOAD_TTL_HOURS = Number(process.env.CONVERTER_DOWNLOAD_TTL_HOURS) || 24;

const OUTPUT_FORMATS: OutputFormat[] = ['mp4', 'mkv', 'mov', 'avi', 'webm'];
const QUALITIES: Quality[] = ['original', 'highest', '1080p', '720p', '480p', '360p'];
const VIDEO_CODECS: VideoCodec[] = ['h264', 'h265', 'av1', 'vp9'];
const AUDIO_CODECS: AudioCodec[] = ['aac', 'mp3', 'opus', 'copy'];
const AUDIO_MODES: AudioMode[] = ['keep', 'remove', 'extract'];
const PRESETS: EncodePreset[] = ['fast', 'balanced', 'high-compression'];

export class ConverterError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const ownerMatches = (job: { userId: string | null; anonId: string | null }, owner: RequestOwner): boolean =>
  owner.userId ? job.userId === owner.userId : job.userId === null && job.anonId === owner.anonId;

const findOwnedJob = async (jobId: string, owner: RequestOwner) => {
  const job = await prisma.conversionJob.findUnique({ where: { id: jobId } });
  if (!job || !ownerMatches(job, owner)) throw new ConverterError('Job not found', 404);
  return job;
};

export const parseConversionOptions = (body: any, sourceDurationSeconds: number | null): ConversionOptions => {
  const { outputFormat, quality, videoCodec, audioCodec, fps, audioMode, preset, trimStartSeconds, trimEndSeconds } = body || {};

  if (!OUTPUT_FORMATS.includes(outputFormat)) throw new ConverterError(`Invalid outputFormat: ${outputFormat}`, 400);
  if (!QUALITIES.includes(quality)) throw new ConverterError(`Invalid quality: ${quality}`, 400);
  if (!VIDEO_CODECS.includes(videoCodec)) throw new ConverterError(`Invalid videoCodec: ${videoCodec}`, 400);
  if (!AUDIO_CODECS.includes(audioCodec)) throw new ConverterError(`Invalid audioCodec: ${audioCodec}`, 400);
  if (!AUDIO_MODES.includes(audioMode)) throw new ConverterError(`Invalid audioMode: ${audioMode}`, 400);
  if (!PRESETS.includes(preset)) throw new ConverterError(`Invalid preset: ${preset}`, 400);

  let parsedFps: 'keep' | number = 'keep';
  if (fps !== undefined && fps !== 'keep') {
    const numericFps = Number(fps);
    if (!Number.isFinite(numericFps) || numericFps <= 0) throw new ConverterError(`Invalid fps: ${fps}`, 400);
    parsedFps = numericFps;
  }

  let parsedTrimStart: number | undefined;
  let parsedTrimEnd: number | undefined;
  if (trimStartSeconds !== undefined || trimEndSeconds !== undefined) {
    parsedTrimStart = Number(trimStartSeconds ?? 0);
    parsedTrimEnd = Number(trimEndSeconds ?? sourceDurationSeconds ?? NaN);
    if (!Number.isFinite(parsedTrimStart) || parsedTrimStart < 0) {
      throw new ConverterError(`Invalid trimStartSeconds: ${trimStartSeconds}`, 400);
    }
    if (!Number.isFinite(parsedTrimEnd) || parsedTrimEnd <= parsedTrimStart) {
      throw new ConverterError(`Invalid trimEndSeconds: ${trimEndSeconds}`, 400);
    }
    if (sourceDurationSeconds !== null && parsedTrimEnd > sourceDurationSeconds) {
      parsedTrimEnd = sourceDurationSeconds;
    }
  }

  return {
    outputFormat,
    quality,
    videoCodec,
    audioCodec,
    fps: parsedFps,
    audioMode,
    preset,
    trimStartSeconds: parsedTrimStart,
    trimEndSeconds: parsedTrimEnd,
  };
};

export interface UploadedFileInfo {
  jobId: string;
  originalFilename: string;
  inputExt: string;
  fileSizeBytes: number;
}

export const toPublicJob = (job: any) => ({
  id: job.id,
  originalFilename: job.originalFilename,
  inputFormat: job.inputFormat,
  outputFormat: job.outputFormat,
  fileSizeBytes: job.fileSizeBytes !== null ? job.fileSizeBytes.toString() : null,
  durationSeconds: job.durationSeconds,
  resolution: job.resolution,
  status: job.status,
  progress: job.progress,
  errorMessage: job.errorMessage,
  createdAt: job.createdAt,
  startedAt: job.startedAt,
  completedAt: job.completedAt,
  downloadExpiresAt: job.downloadExpiresAt,
});

export const createJobFromUpload = async (info: UploadedFileInfo, owner: RequestOwner) => {
  const localInputPath = getInputPath(info.jobId, info.inputExt);
  const inputKey = getInputKey(info.jobId, info.inputExt);
  try {
    const probe = await probeVideo(localInputPath);
    await uploadFileToR2(localInputPath, inputKey);
    const job = await prisma.conversionJob.create({
      data: {
        id: info.jobId,
        userId: owner.userId ?? null,
        anonId: owner.userId ? null : owner.anonId,
        originalFilename: info.originalFilename,
        inputFormat: info.inputExt.replace('.', ''),
        fileSizeBytes: BigInt(info.fileSizeBytes),
        durationSeconds: probe.durationSeconds,
        resolution: probe.width && probe.height ? `${probe.width}x${probe.height}` : null,
        inputPath: inputKey,
        status: 'QUEUED',
      },
    });
    return toPublicJob(job);
  } finally {
    await fs.promises.rm(getJobDir(info.jobId), { recursive: true, force: true });
  }
};

const persistProgress = async (jobId: string, percent: number | null) => {
  try {
    await prisma.conversionJob.update({
      where: { id: jobId },
      data: { progress: percent ?? 0 },
    });
  } catch {
    // Job may have been deleted/cancelled concurrently - safe to ignore.
  }
};

export const startConversion = async (jobId: string, body: any, owner: RequestOwner) => {
  const job = await findOwnedJob(jobId, owner);
  if (job.status !== 'QUEUED' || job.startedAt) {
    throw new ConverterError(`Job cannot be started from status ${job.status}`, 409);
  }
  const options = parseConversionOptions(body, job.durationSeconds);

  const inputExt = `.${job.inputFormat}`;
  const localInputPath = getInputPath(jobId, inputExt);
  const inputKey = job.inputPath as string;
  await fs.promises.mkdir(getInputDir(jobId), { recursive: true });
  await downloadFileFromR2(inputKey, localInputPath);

  const probe = await probeVideo(localInputPath);

  const outputExt = options.audioMode === 'extract' ? AUDIO_EXTRACT_EXTENSION[options.audioCodec] : `.${options.outputFormat}`;
  const localOutputPath = getOutputPath(jobId, outputExt);
  const outputKey = getOutputKey(jobId, outputExt);
  await fs.promises.mkdir(getOutputDir(jobId), { recursive: true });

  const availableEncoders = await detectAvailableEncoders();
  const args = buildFfmpegArgs({
    inputPath: localInputPath,
    outputPath: localOutputPath,
    inputVideoCodec: probe.videoCodec,
    inputAudioCodec: probe.audioCodec,
    options,
    availableEncoders,
  });

  const resolvedOutputFormat = options.audioMode === 'extract' ? outputExt.replace('.', '') : options.outputFormat;

  await prisma.conversionJob.update({
    where: { id: jobId },
    data: { status: 'CONVERTING', startedAt: new Date(), outputFormat: resolvedOutputFormat, progress: 0 },
  });

  const effectiveDurationSeconds =
    options.trimStartSeconds !== undefined && options.trimEndSeconds !== undefined
      ? options.trimEndSeconds - options.trimStartSeconds
      : job.durationSeconds;

  conversionQueue.enqueue({
    jobId,
    run: async (registerCancel) => {
      const { child, done } = runFfmpegWithProgress(args, effectiveDurationSeconds, (update) => {
        void persistProgress(jobId, update.percent);
      });
      registerCancel(() => killGracefully(child));

      const result = await done;

      if (result.success) {
        await uploadFileToR2(localOutputPath, outputKey);
        await fs.promises.rm(getJobDir(jobId), { recursive: true, force: true });
        await deleteFromR2([inputKey]);
        await prisma.conversionJob.update({
          where: { id: jobId },
          data: {
            status: 'COMPLETED',
            progress: 100,
            completedAt: new Date(),
            outputPath: outputKey,
            downloadExpiresAt: new Date(Date.now() + DOWNLOAD_TTL_HOURS * 60 * 60 * 1000),
          },
        });
        return;
      }

      const wasCancelled = result.errorMessage?.startsWith('Conversion cancelled');
      await prisma.conversionJob.update({
        where: { id: jobId },
        data: {
          status: wasCancelled ? 'CANCELLED' : 'FAILED',
          errorMessage: wasCancelled ? null : result.errorMessage,
        },
      });
      await fs.promises.rm(getJobDir(jobId), { recursive: true, force: true });
      await deleteFromR2([inputKey]);
    },
  });

  return toPublicJob({ ...job, status: 'CONVERTING', startedAt: new Date(), outputFormat: resolvedOutputFormat, progress: 0 });
};

export const listJobs = async (owner: RequestOwner) => {
  const jobs = await prisma.conversionJob.findMany({
    where: owner.userId ? { userId: owner.userId } : { userId: null, anonId: owner.anonId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return jobs.map(toPublicJob);
};

export const getJobStatus = async (jobId: string, owner: RequestOwner) => {
  const job = await findOwnedJob(jobId, owner);
  return toPublicJob(job);
};

export const getDownloadableJob = async (jobId: string, owner: RequestOwner) => {
  const job = await findOwnedJob(jobId, owner);
  if (job.status !== 'COMPLETED' || !job.outputPath) {
    throw new ConverterError(`Job is not ready for download (status: ${job.status})`, 409);
  }
  if (job.downloadExpiresAt && job.downloadExpiresAt.getTime() < Date.now()) {
    throw new ConverterError('This converted file has expired. Please convert again.', 410);
  }
  return job;
};

export const getDownloadUrl = async (jobId: string, owner: RequestOwner): Promise<string> => {
  const job = await getDownloadableJob(jobId, owner);
  const safeName =
    (job.originalFilename || 'converted')
      .replace(/[^a-z0-9]/gi, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase()
      .slice(0, 100) || 'converted';
  const filename = `${safeName}.${job.outputFormat}`;
  return getPresignedDownloadUrl(job.outputPath as string, filename);
};

export const deleteJob = async (jobId: string, owner: RequestOwner) => {
  const job = await findOwnedJob(jobId, owner);
  conversionQueue.cancel(jobId);
  await fs.promises.rm(getJobDir(jobId), { recursive: true, force: true });
  await deleteFromR2([job.inputPath, job.outputPath].filter(Boolean) as string[]);
  await prisma.conversionJob.delete({ where: { id: jobId } });
};

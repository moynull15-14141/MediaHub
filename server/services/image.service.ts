import fs from 'fs';
import { prisma } from '../lib/prisma';
import {
  getImageJobDir,
  getImageInputDir,
  getImageOutputDir,
  getImageInputPath,
  getImageOutputPath,
  getImageInputKey,
  getImageOutputKey,
} from '../lib/image-paths';
import { uploadFileToR2, downloadFileFromR2, deleteFromR2, getPresignedDownloadUrl } from '../lib/r2';
import { RequestOwner, ownerMatches } from '../lib/auth-helpers';
import {
  probeImage,
  getFullMetadata,
  processImage,
  ImageProcessOptions,
  ImageOutputFormat,
  ResizeFit,
  ImageColorSpace,
  WATERMARK_FONTS,
} from './image-processing.service';

const DOWNLOAD_TTL_HOURS = Number(process.env.IMAGE_DOWNLOAD_TTL_HOURS) || 24;

const OUTPUT_FORMATS: ImageOutputFormat[] = ['png', 'jpeg', 'webp', 'avif'];
const FITS: ResizeFit[] = ['fill', 'contain', 'cover', 'inside', 'outside'];
const COLOR_SPACES: ImageColorSpace[] = ['srgb', 'cmyk', 'b-w'];
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export class ImageError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const findOwnedJob = async (jobId: string, owner: RequestOwner) => {
  const job = await prisma.imageJob.findUnique({ where: { id: jobId } });
  if (!job || !ownerMatches(job, owner)) throw new ImageError('Job not found', 404);
  return job;
};

export const toPublicImageJob = (job: any) => ({
  id: job.id,
  originalFilename: job.originalFilename,
  inputFormat: job.inputFormat,
  outputFormat: job.outputFormat,
  fileSizeBytes: job.fileSizeBytes !== null ? job.fileSizeBytes.toString() : null,
  width: job.width,
  height: job.height,
  status: job.status,
  errorMessage: job.errorMessage,
  createdAt: job.createdAt,
  completedAt: job.completedAt,
  downloadExpiresAt: job.downloadExpiresAt,
});

export interface UploadedImageInfo {
  jobId: string;
  originalFilename: string;
  inputExt: string;
  fileSizeBytes: number;
}

export const createImageJobFromUpload = async (info: UploadedImageInfo, owner: RequestOwner) => {
  const localInputPath = getImageInputPath(info.jobId, info.inputExt);
  const inputKey = getImageInputKey(info.jobId, info.inputExt);
  try {
    const probe = await probeImage(localInputPath);
    await uploadFileToR2(localInputPath, inputKey);
    const job = await prisma.imageJob.create({
      data: {
        id: info.jobId,
        userId: owner.userId ?? null,
        anonId: owner.userId ? null : owner.anonId,
        originalFilename: info.originalFilename,
        inputFormat: info.inputExt.replace('.', ''),
        fileSizeBytes: BigInt(info.fileSizeBytes),
        width: probe.width,
        height: probe.height,
        inputPath: inputKey,
        status: 'QUEUED',
      },
    });
    return toPublicImageJob(job);
  } finally {
    await fs.promises.rm(getImageJobDir(info.jobId), { recursive: true, force: true });
  }
};

export const parseImageProcessOptions = (body: any): ImageProcessOptions => {
  const {
    outputFormat, quality, progressive, lossless, preserveMetadata,
    resizeWidth, resizeHeight, resizePercent, fit,
    cropX, cropY, cropWidth, cropHeight,
    rotate, flipHorizontal, flipVertical,
    watermarkText, watermarkOpacity, watermarkScale, watermarkXPercent, watermarkYPercent,
    watermarkFontFamily, watermarkColor, watermarkBold,
    colorSpace, brightness, contrast, saturation, hue,
  } = body || {};

  if (!OUTPUT_FORMATS.includes(outputFormat)) throw new ImageError(`Invalid outputFormat: ${outputFormat}`, 400);
  const numericQuality = Number(quality);
  if (!Number.isFinite(numericQuality) || numericQuality < 1 || numericQuality > 100) {
    throw new ImageError(`Invalid quality: ${quality}`, 400);
  }
  if (fit !== undefined && !FITS.includes(fit)) throw new ImageError(`Invalid fit: ${fit}`, 400);
  if (rotate !== undefined && ![90, 180, 270].includes(Number(rotate))) {
    throw new ImageError(`Invalid rotate: ${rotate}`, 400);
  }
  if (colorSpace !== undefined && !COLOR_SPACES.includes(colorSpace)) {
    throw new ImageError(`Invalid colorSpace: ${colorSpace}`, 400);
  }
  if (watermarkFontFamily !== undefined && !WATERMARK_FONTS.includes(watermarkFontFamily)) {
    throw new ImageError(`Invalid watermarkFontFamily: ${watermarkFontFamily}`, 400);
  }
  if (watermarkColor !== undefined && !HEX_COLOR_PATTERN.test(watermarkColor)) {
    throw new ImageError(`Invalid watermarkColor: ${watermarkColor}`, 400);
  }
  const checkRange = (value: any, name: string, min: number, max: number) => {
    if (value === undefined || value === '') return;
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max) throw new ImageError(`Invalid ${name}: ${value}`, 400);
  };
  checkRange(brightness, 'brightness', -100, 100);
  checkRange(contrast, 'contrast', -100, 100);
  checkRange(saturation, 'saturation', -100, 100);
  checkRange(hue, 'hue', -180, 180);
  checkRange(watermarkXPercent, 'watermarkXPercent', 0, 100);
  checkRange(watermarkYPercent, 'watermarkYPercent', 0, 100);

  const toNumberOrUndefined = (v: any) => (v === undefined || v === '' ? undefined : Number(v));
  const toBool = (v: any) => v === true || v === 'true';

  const hasFullCrop =
    cropX !== undefined && cropY !== undefined && cropWidth !== undefined && cropHeight !== undefined;

  return {
    outputFormat,
    quality: numericQuality,
    progressive: toBool(progressive),
    lossless: toBool(lossless),
    preserveMetadata: toBool(preserveMetadata),
    resizeWidth: toNumberOrUndefined(resizeWidth),
    resizeHeight: toNumberOrUndefined(resizeHeight),
    resizePercent: toNumberOrUndefined(resizePercent),
    fit,
    ...(hasFullCrop
      ? {
          cropX: Number(cropX),
          cropY: Number(cropY),
          cropWidth: Number(cropWidth),
          cropHeight: Number(cropHeight),
        }
      : {}),
    rotate: rotate !== undefined ? (Number(rotate) as 90 | 180 | 270) : undefined,
    flipHorizontal: toBool(flipHorizontal),
    flipVertical: toBool(flipVertical),
    watermarkText: watermarkText || undefined,
    watermarkOpacity: toNumberOrUndefined(watermarkOpacity),
    watermarkScale: toNumberOrUndefined(watermarkScale),
    watermarkXPercent: toNumberOrUndefined(watermarkXPercent),
    watermarkYPercent: toNumberOrUndefined(watermarkYPercent),
    watermarkFontFamily,
    watermarkColor,
    watermarkBold: toBool(watermarkBold),
    colorSpace,
    brightness: toNumberOrUndefined(brightness),
    contrast: toNumberOrUndefined(contrast),
    saturation: toNumberOrUndefined(saturation),
    hue: toNumberOrUndefined(hue),
  };
};

export const processImageJob = async (
  jobId: string,
  options: ImageProcessOptions,
  owner: RequestOwner,
  watermarkLocalPath?: string,
) => {
  const job = await findOwnedJob(jobId, owner);

  const inputExt = `.${job.inputFormat}`;
  const localInputPath = getImageInputPath(jobId, inputExt);
  const outputExt = `.${options.outputFormat}`;
  const localOutputPath = getImageOutputPath(jobId, outputExt);
  const outputKey = getImageOutputKey(jobId, outputExt);

  try {
    await fs.promises.mkdir(getImageInputDir(jobId), { recursive: true });
    await fs.promises.mkdir(getImageOutputDir(jobId), { recursive: true });
    await downloadFileFromR2(job.inputPath as string, localInputPath);

    await processImage(localInputPath, localOutputPath, {
      ...options,
      watermarkImagePath: watermarkLocalPath,
    });

    const outputStat = await fs.promises.stat(localOutputPath);
    await uploadFileToR2(localOutputPath, outputKey);

    const updated = await prisma.imageJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        outputFormat: options.outputFormat,
        fileSizeBytes: BigInt(outputStat.size),
        outputPath: outputKey,
        completedAt: new Date(),
        downloadExpiresAt: new Date(Date.now() + DOWNLOAD_TTL_HOURS * 60 * 60 * 1000),
      },
    });
    return toPublicImageJob(updated);
  } catch (err: any) {
    await prisma.imageJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', errorMessage: err.message || 'Image processing failed' },
    }).catch(() => {});
    throw err;
  } finally {
    await fs.promises.rm(getImageJobDir(jobId), { recursive: true, force: true });
  }
};

export const getImageMetadataForJob = async (jobId: string, owner: RequestOwner) => {
  const job = await findOwnedJob(jobId, owner);
  const inputExt = `.${job.inputFormat}`;
  const localInputPath = getImageInputPath(jobId, inputExt);
  try {
    await fs.promises.mkdir(getImageInputDir(jobId), { recursive: true });
    await downloadFileFromR2(job.inputPath as string, localInputPath);
    return await getFullMetadata(localInputPath);
  } finally {
    await fs.promises.rm(getImageJobDir(jobId), { recursive: true, force: true });
  }
};

export const listImageJobs = async (owner: RequestOwner) => {
  const jobs = await prisma.imageJob.findMany({
    where: owner.userId ? { userId: owner.userId } : { userId: null, anonId: owner.anonId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return jobs.map(toPublicImageJob);
};

export const getImageDownloadUrl = async (jobId: string, owner: RequestOwner): Promise<string> => {
  const job = await findOwnedJob(jobId, owner);
  if (job.status !== 'COMPLETED' || !job.outputPath) {
    throw new ImageError(`Job is not ready for download (status: ${job.status})`, 409);
  }
  if (job.downloadExpiresAt && job.downloadExpiresAt.getTime() < Date.now()) {
    throw new ImageError('This processed file has expired. Please process again.', 410);
  }
  const safeName =
    (job.originalFilename || 'image')
      .replace(/[^a-z0-9]/gi, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase()
      .slice(0, 100) || 'image';
  const filename = `${safeName}.${job.outputFormat}`;
  return getPresignedDownloadUrl(job.outputPath, filename);
};

export const deleteImageJob = async (jobId: string, owner: RequestOwner) => {
  const job = await findOwnedJob(jobId, owner);
  await fs.promises.rm(getImageJobDir(jobId), { recursive: true, force: true });
  await deleteFromR2([job.inputPath, job.outputPath].filter(Boolean) as string[]);
  await prisma.imageJob.delete({ where: { id: jobId } });
};

import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma';
import {
  getPdfJobDir, getPdfInputDir, getPdfOutputDir, getPdfThumbDir,
  getPdfInputPath, getPdfOutputPath, getPdfInputKey, getPdfOutputKey, getPdfThumbKey,
} from '../lib/pdf-paths';
import { uploadFileToR2, downloadFileFromR2, deleteFromR2, getPresignedDownloadUrl, getPresignedViewUrl } from '../lib/r2';
import { RequestOwner, ownerMatches } from '../lib/auth-helpers';
import { probeImage } from './image-processing.service';
import {
  getPdfPageCount, mergePdfs, splitPdf, SplitRange, rotatePdf, deletePages, rearrangePages,
  jpgToPdf, pdfToImage, RasterFormat, generatePageThumbnails, quickCompressPdf, compressPdfToTarget, CompressLevel,
  protectPdf, unlockPdf, zipFiles, extractTextItems, getPdfPageDimensions, applyTextEdits, TextEdit,
} from './pdf-tools.service';

const DOWNLOAD_TTL_HOURS = Number(process.env.PDF_DOWNLOAD_TTL_HOURS) || 24;
const MAX_THUMBNAIL_PAGES = 300;

export const PDF_OPERATIONS = [
  'MERGE', 'SPLIT', 'COMPRESS', 'PDF_TO_JPG', 'JPG_TO_PDF',
  'ROTATE', 'DELETE_PAGES', 'REARRANGE', 'PROTECT', 'UNLOCK', 'EDIT_TEXT',
] as const;
export type PdfOperationValue = (typeof PDF_OPERATIONS)[number];

const MULTI_PDF_OPS = new Set<PdfOperationValue>(['MERGE']);
const MULTI_IMAGE_OPS = new Set<PdfOperationValue>(['JPG_TO_PDF']);
const SINGLE_PDF_OPS = new Set<PdfOperationValue>([
  'SPLIT', 'COMPRESS', 'PDF_TO_JPG', 'ROTATE', 'DELETE_PAGES', 'REARRANGE', 'PROTECT', 'UNLOCK', 'EDIT_TEXT',
]);

export class PdfError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  PDF_IS_PASSWORD_PROTECTED: 'This PDF is password protected. Use Unlock PDF first.',
  INVALID_PDF_FILE: 'The file is not a valid PDF or is corrupted.',
  INCORRECT_PASSWORD: 'The password is incorrect.',
  CANNOT_DELETE_ALL_PAGES: 'You cannot delete every page - at least one page must remain.',
  NO_VALID_PAGES_TO_DELETE: 'No valid pages were specified to delete.',
  INVALID_PAGE_ORDER: 'The new page order must include every page exactly once.',
  PDF_ALREADY_PROTECTED: 'This PDF is already password protected.',
  PDF_NOT_PROTECTED: 'This PDF is not password protected.',
  PDF_RENDER_FAILED: 'Could not render this PDF to images.',
  COMPRESSION_FAILED: 'Compression failed for this file.',
  INVALID_PAGE_NUMBER: 'That page does not exist in this document.',
};

const friendlyPdfErrorMessage = (err: any): string => {
  if (err instanceof PdfError) return err.message;
  const code = err?.message;
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  return 'Processing failed. Please try again.';
};

export const isValidPdfOperation = (value: any): value is PdfOperationValue => PDF_OPERATIONS.includes(value);

const findOwnedJob = async (jobId: string, owner: RequestOwner) => {
  const job = await prisma.pdfJob.findUnique({ where: { id: jobId } });
  if (!job || !ownerMatches(job, owner)) throw new PdfError('Job not found', 404);
  return job;
};

export const toPublicPdfJob = (job: any) => ({
  id: job.id,
  operation: job.operation,
  originalFilename: job.originalFilename,
  inputFormat: job.inputFormat,
  outputFormat: job.outputFormat,
  fileSizeBytes: job.fileSizeBytes !== null ? job.fileSizeBytes.toString() : null,
  outputFileSizeBytes: job.outputFileSizeBytes !== null ? job.outputFileSizeBytes.toString() : null,
  pageCount: job.pageCount,
  inputCount: job.inputPaths.length,
  status: job.status,
  errorMessage: job.errorMessage,
  resultMessage: job.resultMessage,
  createdAt: job.createdAt,
  completedAt: job.completedAt,
  downloadExpiresAt: job.downloadExpiresAt,
});

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export interface UploadedPdfFileInfo {
  index: number;
  originalFilename: string;
  ext: string;
  fileSizeBytes: number;
  localPath: string;
}

const ALLOWED_PDF_EXT = new Set(['.pdf']);
const ALLOWED_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png']);

const validateFilesForOperation = (operation: PdfOperationValue, files: UploadedPdfFileInfo[]) => {
  if (files.length === 0) throw new PdfError('No file uploaded', 400);

  if (MULTI_PDF_OPS.has(operation)) {
    if (files.length < 2) throw new PdfError('Merge needs at least 2 PDF files', 400);
    if (files.some((f) => !ALLOWED_PDF_EXT.has(f.ext))) throw new PdfError('All files must be PDFs', 400);
    return;
  }
  if (MULTI_IMAGE_OPS.has(operation)) {
    if (files.some((f) => !ALLOWED_IMAGE_EXT.has(f.ext))) throw new PdfError('All files must be JPG or PNG images', 400);
    return;
  }
  if (SINGLE_PDF_OPS.has(operation)) {
    if (files.length !== 1) throw new PdfError('This tool accepts exactly one PDF file', 400);
    if (!ALLOWED_PDF_EXT.has(files[0].ext)) throw new PdfError('The uploaded file must be a PDF', 400);
    return;
  }
  throw new PdfError(`Invalid operation: ${operation}`, 400);
};

export const createPdfJobFromUpload = async (
  jobId: string,
  operation: PdfOperationValue,
  files: UploadedPdfFileInfo[],
  owner: RequestOwner,
) => {
  try {
    validateFilesForOperation(operation, files);

    if (MULTI_PDF_OPS.has(operation)) {
      for (const file of files) {
        try {
          await getPdfPageCount(file.localPath);
        } catch (err: any) {
          throw new PdfError(
            err.message === 'PDF_IS_PASSWORD_PROTECTED'
              ? `"${file.originalFilename}" is password protected. Unlock it first.`
              : `"${file.originalFilename}" is not a valid PDF.`,
            400,
          );
        }
      }
    } else if (MULTI_IMAGE_OPS.has(operation)) {
      for (const file of files) {
        try {
          await probeImage(file.localPath);
        } catch {
          throw new PdfError(`"${file.originalFilename}" is not a valid image.`, 400);
        }
      }
    }

    let pageCount: number | null = null;
    if (SINGLE_PDF_OPS.has(operation)) {
      try {
        pageCount = await getPdfPageCount(files[0].localPath);
        // getPdfPageCount only succeeds without a password when the file isn't
        // actually encrypted - qpdf --decrypt is a silent no-op on such a file,
        // so catch this up front instead of letting Unlock "succeed" pointlessly.
        if (operation === 'UNLOCK') {
          throw new PdfError('This PDF is not password protected.', 400);
        }
      } catch (err: any) {
        if (err instanceof PdfError) throw err;
        if (err.message === 'PDF_IS_PASSWORD_PROTECTED') {
          if (operation !== 'UNLOCK') {
            throw new PdfError('This PDF is password protected. Use Unlock PDF first.', 400);
          }
          pageCount = null;
        } else {
          throw new PdfError('The uploaded file is not a valid PDF or is corrupted', 400);
        }
      }
    }

    const inputKeys: string[] = [];
    for (const file of files) {
      const key = getPdfInputKey(jobId, file.index, file.ext);
      await uploadFileToR2(file.localPath, key);
      inputKeys.push(key);
    }

    let thumbnailKeys: string[] = [];
    if (SINGLE_PDF_OPS.has(operation) && operation !== 'UNLOCK' && pageCount && pageCount <= MAX_THUMBNAIL_PAGES) {
      try {
        const thumbDir = getPdfThumbDir(jobId);
        const thumbDpi = operation === 'EDIT_TEXT' ? 150 : 72;
        const count = await generatePageThumbnails(files[0].localPath, thumbDir, pageCount, thumbDpi);
        for (let p = 1; p <= count; p++) {
          const localThumb = path.join(thumbDir, `page-${p}.jpg`);
          if (fs.existsSync(localThumb)) {
            const key = getPdfThumbKey(jobId, p);
            await uploadFileToR2(localThumb, key);
            thumbnailKeys.push(key);
          }
        }
      } catch {
        // Thumbnails are a nice-to-have preview; never fail the upload over them.
        thumbnailKeys = [];
      }
    }

    const totalBytes = files.reduce((sum, f) => sum + f.fileSizeBytes, 0);
    const displayName =
      files.length > 1 ? `${files[0].originalFilename} (+${files.length - 1} more)` : files[0].originalFilename;

    const job = await prisma.pdfJob.create({
      data: {
        id: jobId,
        userId: owner.userId ?? null,
        anonId: owner.userId ? null : owner.anonId,
        operation,
        originalFilename: displayName,
        inputFormat: files[0].ext.replace('.', ''),
        fileSizeBytes: BigInt(totalBytes),
        pageCount,
        inputPaths: inputKeys,
        thumbnailPaths: thumbnailKeys,
        status: 'QUEUED',
      },
    });

    const thumbnails = await Promise.all(thumbnailKeys.map((key) => getPresignedViewUrl(key)));
    return { ...toPublicPdfJob(job), thumbnails };
  } finally {
    await fs.promises.rm(getPdfJobDir(jobId), { recursive: true, force: true });
  }
};

// ---------------------------------------------------------------------------
// Option parsing (mirrors converter/image "parse*Options" validation style)
// ---------------------------------------------------------------------------

const parsePagesList = (raw: any, pageCount: number): number[] => {
  if (!Array.isArray(raw) || raw.length === 0) throw new PdfError('At least one page must be specified', 400);
  const nums = raw.map((v) => Number(v));
  if (nums.some((n) => !Number.isInteger(n) || n < 1 || (pageCount > 0 && n > pageCount))) {
    throw new PdfError(`Invalid page number (document has ${pageCount || 'an unknown number of'} pages)`, 400);
  }
  return nums;
};

const parseRotateOptions = (raw: any, pageCount: number) => {
  const angle = Number(raw?.angle);
  if (![90, 180, 270].includes(angle)) throw new PdfError(`Invalid rotate angle: ${raw?.angle}`, 400);
  const pages = Array.isArray(raw?.pages) && raw.pages.length > 0 ? parsePagesList(raw.pages, pageCount) : undefined;
  return { angle: angle as 90 | 180 | 270, pages };
};

const parseSplitRanges = (raw: any, pageCount: number): SplitRange[] => {
  const mode = raw?.mode;
  if (mode === 'each') {
    if (!pageCount) throw new PdfError('Unknown page count for this document', 400);
    return Array.from({ length: pageCount }, (_, i) => ({ from: i + 1, to: i + 1 }));
  }
  if (mode === 'ranges') {
    const ranges = raw?.ranges;
    if (!Array.isArray(ranges) || ranges.length === 0) throw new PdfError('At least one page range is required', 400);
    return ranges.map((r: any) => {
      const from = Number(r.from);
      const to = Number(r.to);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || (pageCount > 0 && to > pageCount)) {
        throw new PdfError(`Invalid page range: ${from}-${to}`, 400);
      }
      return { from, to };
    });
  }
  throw new PdfError(`Invalid split mode: ${mode}`, 400);
};

const MIN_TARGET_BYTES = 10 * 1024;

const parseCompressOptions = (raw: any) => {
  const mode = raw?.mode;
  if (mode === 'quick') {
    const level = raw?.level;
    if (!['low', 'recommended', 'high'].includes(level)) throw new PdfError(`Invalid compression level: ${level}`, 400);
    return { mode: 'quick' as const, level: level as CompressLevel, targetBytes: undefined as number | undefined };
  }
  if (mode === 'target') {
    const targetBytes = Number(raw?.targetBytes);
    if (!Number.isFinite(targetBytes) || targetBytes < MIN_TARGET_BYTES) {
      throw new PdfError('Target size must be at least 10 KB', 400);
    }
    return { mode: 'target' as const, level: undefined as CompressLevel | undefined, targetBytes };
  }
  throw new PdfError(`Invalid compression mode: ${mode}`, 400);
};

const parseDpi = (raw: any) => {
  if (raw?.dpi === undefined || raw?.dpi === '') return 150;
  const dpi = Number(raw.dpi);
  if (!Number.isFinite(dpi) || dpi < 72 || dpi > 300) throw new PdfError(`Invalid dpi: ${raw.dpi}`, 400);
  return dpi;
};

const parseRasterFormat = (raw: any): RasterFormat => {
  if (raw?.format === undefined || raw?.format === '') return 'jpeg';
  if (raw.format !== 'jpeg' && raw.format !== 'png') throw new PdfError(`Invalid format: ${raw.format}`, 400);
  return raw.format;
};

const MAX_TEXT_EDITS = 200;
const MAX_TEXT_EDIT_LENGTH = 500;

const parseTextEdits = (rawOptions: any, pageCount: number): TextEdit[] => {
  const edits = rawOptions?.edits;
  if (!Array.isArray(edits) || edits.length === 0) throw new PdfError('At least one text edit is required', 400);
  if (edits.length > MAX_TEXT_EDITS) throw new PdfError(`Too many edits at once (max ${MAX_TEXT_EDITS})`, 400);

  return edits.map((e: any) => {
    const page = Number(e.page);
    const x = Number(e.x);
    const y = Number(e.y);
    const width = Number(e.width);
    const height = Number(e.height);
    const fontSize = Number(e.fontSize);
    if (!Number.isInteger(page) || page < 1 || (pageCount > 0 && page > pageCount)) {
      throw new PdfError(`Invalid page in text edit: ${e.page}`, 400);
    }
    if (![x, y, width, height, fontSize].every((n) => Number.isFinite(n)) || fontSize <= 0 || width < 0) {
      throw new PdfError('Invalid text edit position data', 400);
    }
    if (typeof e.newText !== 'string') throw new PdfError('newText must be a string', 400);
    return { page, x, y, width, height, fontSize, newText: e.newText.slice(0, MAX_TEXT_EDIT_LENGTH) };
  });
};

const parsePassword = (raw: any, minLength: number) => {
  if (typeof raw !== 'string' || raw.length < minLength) {
    throw new PdfError(minLength > 1 ? `Password must be at least ${minLength} characters` : 'Password is required', 400);
  }
  return raw;
};

// ---------------------------------------------------------------------------
// Process
// ---------------------------------------------------------------------------

export const processPdfJob = async (jobId: string, rawOptions: any, owner: RequestOwner) => {
  const job = await findOwnedJob(jobId, owner);
  if (job.status === 'PROCESSING') throw new PdfError('This job is already processing', 409);
  if (job.status === 'COMPLETED') throw new PdfError('This job has already completed', 409);

  await prisma.pdfJob.update({ where: { id: jobId }, data: { status: 'PROCESSING', errorMessage: null } });

  const inputDir = getPdfInputDir(jobId);
  const outputDir = getPdfOutputDir(jobId);

  try {
    await fs.promises.mkdir(inputDir, { recursive: true });
    await fs.promises.mkdir(outputDir, { recursive: true });

    const localInputs: string[] = [];
    for (let i = 0; i < job.inputPaths.length; i++) {
      const key = job.inputPaths[i];
      const localPath = getPdfInputPath(jobId, i, path.extname(key));
      await downloadFileFromR2(key, localPath);
      localInputs.push(localPath);
    }

    let outputFilename: string;
    let outputLocalPath: string;
    let resultMessage: string | undefined;

    switch (job.operation as PdfOperationValue) {
      case 'MERGE': {
        outputFilename = 'merged.pdf';
        outputLocalPath = getPdfOutputPath(jobId, outputFilename);
        await mergePdfs(localInputs, outputLocalPath);
        break;
      }
      case 'SPLIT': {
        const ranges = parseSplitRanges(rawOptions, job.pageCount || 0);
        const parts = await splitPdf(localInputs[0], ranges, outputDir);
        outputFilename = 'split-pages.zip';
        outputLocalPath = getPdfOutputPath(jobId, outputFilename);
        await zipFiles(parts, outputLocalPath);
        break;
      }
      case 'COMPRESS': {
        const { mode, level, targetBytes } = parseCompressOptions(rawOptions);
        outputFilename = 'compressed.pdf';
        outputLocalPath = getPdfOutputPath(jobId, outputFilename);
        if (mode === 'target') {
          const result = await compressPdfToTarget(localInputs[0], outputLocalPath, targetBytes!);
          resultMessage = result.message;
        } else {
          await quickCompressPdf(localInputs[0], outputLocalPath, level!);
        }
        break;
      }
      case 'PDF_TO_JPG': {
        const dpi = parseDpi(rawOptions);
        const format = parseRasterFormat(rawOptions);
        const imageExt = format === 'png' ? 'png' : 'jpg';
        const images = await pdfToImage(localInputs[0], outputDir, format, dpi);
        if (images.length === 1) {
          outputFilename = `page.${imageExt}`;
          outputLocalPath = getPdfOutputPath(jobId, outputFilename);
          await fs.promises.rename(images[0], outputLocalPath);
        } else {
          outputFilename = 'pdf-pages.zip';
          outputLocalPath = getPdfOutputPath(jobId, outputFilename);
          await zipFiles(images, outputLocalPath);
        }
        break;
      }
      case 'JPG_TO_PDF': {
        outputFilename = 'images.pdf';
        outputLocalPath = getPdfOutputPath(jobId, outputFilename);
        await jpgToPdf(localInputs, outputLocalPath);
        break;
      }
      case 'ROTATE': {
        const { angle, pages } = parseRotateOptions(rawOptions, job.pageCount || 0);
        outputFilename = 'rotated.pdf';
        outputLocalPath = getPdfOutputPath(jobId, outputFilename);
        await rotatePdf(localInputs[0], outputLocalPath, angle, pages);
        break;
      }
      case 'DELETE_PAGES': {
        const pages = parsePagesList(rawOptions?.pages, job.pageCount || 0);
        outputFilename = 'edited.pdf';
        outputLocalPath = getPdfOutputPath(jobId, outputFilename);
        await deletePages(localInputs[0], outputLocalPath, pages);
        break;
      }
      case 'REARRANGE': {
        const order = parsePagesList(rawOptions?.order, job.pageCount || 0);
        outputFilename = 'rearranged.pdf';
        outputLocalPath = getPdfOutputPath(jobId, outputFilename);
        await rearrangePages(localInputs[0], outputLocalPath, order);
        break;
      }
      case 'PROTECT': {
        const password = parsePassword(rawOptions?.password, 4);
        outputFilename = 'protected.pdf';
        outputLocalPath = getPdfOutputPath(jobId, outputFilename);
        await protectPdf(localInputs[0], outputLocalPath, password);
        break;
      }
      case 'UNLOCK': {
        const password = parsePassword(rawOptions?.password, 1);
        outputFilename = 'unlocked.pdf';
        outputLocalPath = getPdfOutputPath(jobId, outputFilename);
        await unlockPdf(localInputs[0], outputLocalPath, password);
        break;
      }
      case 'EDIT_TEXT': {
        const edits = parseTextEdits(rawOptions, job.pageCount || 0);
        outputFilename = 'edited-text.pdf';
        outputLocalPath = getPdfOutputPath(jobId, outputFilename);
        await applyTextEdits(localInputs[0], outputLocalPath, edits);
        break;
      }
      default:
        throw new PdfError(`Unsupported operation: ${job.operation}`, 400);
    }

    const outStat = await fs.promises.stat(outputLocalPath);
    const outputKey = getPdfOutputKey(jobId, outputFilename);
    await uploadFileToR2(outputLocalPath, outputKey);

    const updated = await prisma.pdfJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        outputFormat: path.extname(outputFilename).replace('.', ''),
        outputFileSizeBytes: BigInt(outStat.size),
        outputPath: outputKey,
        resultMessage: resultMessage ?? null,
        completedAt: new Date(),
        downloadExpiresAt: new Date(Date.now() + DOWNLOAD_TTL_HOURS * 60 * 60 * 1000),
      },
    });

    await deleteFromR2([...job.inputPaths, ...job.thumbnailPaths]);

    return toPublicPdfJob(updated);
  } catch (err: any) {
    const message = friendlyPdfErrorMessage(err);
    await prisma.pdfJob
      .update({ where: { id: jobId }, data: { status: 'FAILED', errorMessage: message } })
      .catch(() => {});
    throw err instanceof PdfError ? err : new PdfError(message, 400);
  } finally {
    await fs.promises.rm(getPdfJobDir(jobId), { recursive: true, force: true });
  }
};

// ---------------------------------------------------------------------------
// List / status / download / delete
// ---------------------------------------------------------------------------

export const listPdfJobs = async (owner: RequestOwner) => {
  const jobs = await prisma.pdfJob.findMany({
    where: owner.userId ? { userId: owner.userId } : { userId: null, anonId: owner.anonId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return jobs.map(toPublicPdfJob);
};

export const getPdfJobStatus = async (jobId: string, owner: RequestOwner) => {
  const job = await findOwnedJob(jobId, owner);
  const thumbnails = await Promise.all((job.thumbnailPaths || []).map((key) => getPresignedViewUrl(key)));
  return { ...toPublicPdfJob(job), thumbnails };
};

// Used by the Edit Text tool's page-by-page overlay editor: locates every
// text run on one page so the frontend can draw a clickable box over each.
export const getPdfTextItems = async (jobId: string, page: number, owner: RequestOwner) => {
  const job = await findOwnedJob(jobId, owner);
  const inputKey = job.inputPaths[0];
  if (!inputKey) throw new PdfError('No input file for this job', 404);

  const localPath = getPdfInputPath(jobId, 0, path.extname(inputKey));
  try {
    await fs.promises.mkdir(getPdfInputDir(jobId), { recursive: true });
    await downloadFileFromR2(inputKey, localPath);
    const [items, dims] = await Promise.all([
      extractTextItems(localPath, page),
      getPdfPageDimensions(localPath, page),
    ]);
    return { items, pageWidth: dims.width, pageHeight: dims.height };
  } catch (err: any) {
    if (err.message === 'INVALID_PAGE_NUMBER') throw new PdfError('That page does not exist in this document.', 400);
    throw new PdfError('Failed to read text from this PDF.', 500);
  } finally {
    await fs.promises.rm(getPdfJobDir(jobId), { recursive: true, force: true });
  }
};

export const getPdfDownloadUrl = async (jobId: string, owner: RequestOwner): Promise<string> => {
  const job = await findOwnedJob(jobId, owner);
  if (job.status !== 'COMPLETED' || !job.outputPath) {
    throw new PdfError(`Job is not ready for download (status: ${job.status})`, 409);
  }
  if (job.downloadExpiresAt && job.downloadExpiresAt.getTime() < Date.now()) {
    throw new PdfError('This file has expired. Please process it again.', 410);
  }
  const safeName =
    (job.originalFilename || 'document')
      .replace(/[^a-z0-9]/gi, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase()
      .slice(0, 100) || 'document';
  const filename = `${safeName}.${job.outputFormat}`;
  return getPresignedDownloadUrl(job.outputPath, filename);
};

export const deletePdfJob = async (jobId: string, owner: RequestOwner) => {
  const job = await findOwnedJob(jobId, owner);
  await fs.promises.rm(getPdfJobDir(jobId), { recursive: true, force: true });
  await deleteFromR2([...job.inputPaths, ...job.thumbnailPaths, job.outputPath].filter(Boolean) as string[]);
  await prisma.pdfJob.delete({ where: { id: jobId } });
};

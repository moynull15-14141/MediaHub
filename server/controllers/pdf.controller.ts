import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getRequestOwner } from '../lib/auth-helpers';
import { getPdfInputDir, getPdfJobDir, isValidPdfJobId } from '../lib/pdf-paths';
import {
  createPdfJobFromUpload,
  processPdfJob,
  listPdfJobs,
  getPdfJobStatus,
  getPdfDownloadUrl,
  deletePdfJob,
  getPdfTextItems,
  isValidPdfOperation,
  PdfError,
} from '../services/pdf.service';

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png']);
const ALLOWED_MIME_PREFIXES = ['application/pdf', 'image/', 'application/octet-stream'];
const MAX_UPLOAD_MB = Number(process.env.PDF_MAX_UPLOAD_MB) || 300;
const MAX_FILES = 40;

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const jobId = (req as any).jobId as string;
    const dir = getPdfInputDir(jobId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const index = (req as any).pdfFileIndex++;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `source-${index}${ext}`);
  },
});

const fileFilter: NonNullable<multer.Options['fileFilter']> = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const mimeOk = ALLOWED_MIME_PREFIXES.some((prefix) => file.mimetype.startsWith(prefix));
  if (!ALLOWED_EXTENSIONS.has(ext) || !mimeOk) {
    cb(new Error('UNSUPPORTED_FILE_TYPE'));
    return;
  }
  cb(null, true);
};

export const uploadMiddleware = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: MAX_FILES },
});

export const stampJobId = (req: Request, _res: Response, next: NextFunction) => {
  (req as any).jobId = crypto.randomUUID();
  (req as any).pdfFileIndex = 0;
  next();
};

export const handleUploadError = (err: any, req: Request, res: Response, _next: NextFunction) => {
  const jobId = (req as any).jobId as string | undefined;
  if (jobId) {
    fs.rm(getPdfJobDir(jobId), { recursive: true, force: true }, () => {});
  }
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: `A file exceeds the ${MAX_UPLOAD_MB}MB upload limit` });
      return;
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      res.status(400).json({ error: `Too many files uploaded at once (max ${MAX_FILES})` });
      return;
    }
  }
  if (err.message === 'UNSUPPORTED_FILE_TYPE') {
    res.status(400).json({ error: 'Unsupported file type. Allowed: pdf, jpg, jpeg, png' });
    return;
  }
  console.error('PDF upload error:', err);
  res.status(500).json({ error: 'Upload failed' });
};

export const upload = async (req: Request, res: Response) => {
  const files = (req.files as Express.Multer.File[]) || [];
  const jobId = (req as any).jobId as string;
  const operation = req.body?.operation;

  if (!isValidPdfOperation(operation)) {
    fs.rm(getPdfJobDir(jobId), { recursive: true, force: true }, () => {});
    res.status(400).json({ error: 'Invalid or missing operation' });
    return;
  }
  if (files.length === 0) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  try {
    const fileInfos = files.map((file, index) => ({
      index,
      originalFilename: file.originalname.slice(0, 255),
      ext: path.extname(file.originalname).toLowerCase(),
      fileSizeBytes: file.size,
      localPath: file.path,
    }));
    const job = await createPdfJobFromUpload(jobId, operation, fileInfos, getRequestOwner(req, res));
    res.status(201).json(job);
  } catch (err: any) {
    if (err instanceof PdfError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('PDF job creation error:', err);
    res.status(400).json({ error: 'Failed to process the uploaded file(s)' });
  }
};

export const processHandler = async (req: Request, res: Response) => {
  const { jobId, ...options } = req.body || {};
  if (!jobId || typeof jobId !== 'string' || !isValidPdfJobId(jobId)) {
    res.status(400).json({ error: 'Invalid or missing jobId' });
    return;
  }
  try {
    const job = await processPdfJob(jobId, options, getRequestOwner(req, res));
    res.status(200).json(job);
  } catch (err: any) {
    if (err instanceof PdfError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('PDF process error:', err);
    res.status(500).json({ error: 'Failed to process PDF' });
  }
};

export const listJobsHandler = async (req: Request, res: Response) => {
  try {
    const jobs = await listPdfJobs(getRequestOwner(req, res));
    res.json(jobs);
  } catch (err) {
    console.error('List PDF jobs error:', err);
    res.status(500).json({ error: 'Failed to list PDF jobs' });
  }
};

export const statusHandler = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isValidPdfJobId(id)) {
    res.status(400).json({ error: 'Invalid job id' });
    return;
  }
  try {
    const job = await getPdfJobStatus(id, getRequestOwner(req, res));
    res.json(job);
  } catch (err: any) {
    if (err instanceof PdfError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: 'Failed to fetch job status' });
  }
};

export const textItemsHandler = async (req: Request, res: Response) => {
  const { id, page } = req.params;
  if (!isValidPdfJobId(id)) {
    res.status(400).json({ error: 'Invalid job id' });
    return;
  }
  const pageNum = Number(page);
  if (!Number.isInteger(pageNum) || pageNum < 1) {
    res.status(400).json({ error: 'Invalid page number' });
    return;
  }
  try {
    const result = await getPdfTextItems(id, pageNum, getRequestOwner(req, res));
    res.json(result);
  } catch (err: any) {
    if (err instanceof PdfError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('PDF text items error:', err);
    res.status(500).json({ error: 'Failed to extract text from this PDF' });
  }
};

export const downloadHandler = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isValidPdfJobId(id)) {
    res.status(400).json({ error: 'Invalid job id' });
    return;
  }
  try {
    const url = await getPdfDownloadUrl(id, getRequestOwner(req, res));
    res.json({ url });
  } catch (err: any) {
    if (err instanceof PdfError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: 'Failed to download file' });
  }
};

export const deleteHandler = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isValidPdfJobId(id)) {
    res.status(400).json({ error: 'Invalid job id' });
    return;
  }
  try {
    await deletePdfJob(id, getRequestOwner(req, res));
    res.status(204).send();
  } catch (err: any) {
    if (err instanceof PdfError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: 'Failed to delete job' });
  }
};

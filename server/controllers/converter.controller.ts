import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getRequestOwner } from '../lib/auth-helpers';
import { getInputDir, getJobDir, isValidJobId } from '../lib/converter-paths';
import {
  createJobFromUpload,
  startConversion,
  listJobs,
  getJobStatus,
  getDownloadUrl,
  deleteJob,
  ConverterError,
} from '../services/converter.service';

const ALLOWED_EXTENSIONS = new Set(['.mp4', '.mkv', '.mov', '.avi', '.webm', '.flv', '.m4v']);
const ALLOWED_MIME_PREFIXES = ['video/', 'application/octet-stream'];
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 2048;

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const jobId = (req as any).jobId as string;
    const dir = getInputDir(jobId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `source${ext}`);
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
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

export const stampJobId = (req: Request, _res: Response, next: NextFunction) => {
  (req as any).jobId = crypto.randomUUID();
  next();
};

export const handleUploadError = (err: any, req: Request, res: Response, _next: NextFunction) => {
  const jobId = (req as any).jobId as string | undefined;
  if (jobId) {
    fs.rm(getJobDir(jobId), { recursive: true, force: true }, () => {});
  }
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: `File exceeds the ${MAX_UPLOAD_MB}MB upload limit` });
    return;
  }
  if (err.code === 'ENOSPC') {
    res.status(507).json({ error: 'The server ran out of disk space during upload' });
    return;
  }
  if (err.message === 'UNSUPPORTED_FILE_TYPE') {
    res.status(400).json({ error: 'Unsupported file type. Allowed: mp4, mkv, mov, avi, webm, flv, m4v' });
    return;
  }
  console.error('Upload error:', err);
  res.status(500).json({ error: 'Upload failed' });
};

export const upload = async (req: Request, res: Response) => {
  const file = req.file;
  const jobId = (req as any).jobId as string;
  if (!file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  try {
    const ext = path.extname(file.originalname).toLowerCase();
    const job = await createJobFromUpload(
      { jobId, originalFilename: file.originalname.slice(0, 255), inputExt: ext, fileSizeBytes: file.size },
      getRequestOwner(req, res),
    );
    res.status(201).json(job);
  } catch (err: any) {
    const message =
      err.message === 'NOT_A_VIDEO_FILE' || err.message === 'INVALID_MEDIA_FILE'
        ? 'The uploaded file is not a valid video or is corrupted'
        : 'Failed to process the uploaded file';
    res.status(400).json({ error: message });
  }
};

export const start = async (req: Request, res: Response) => {
  const { jobId } = req.body || {};
  if (!jobId || typeof jobId !== 'string' || !isValidJobId(jobId)) {
    res.status(400).json({ error: 'Invalid or missing jobId' });
    return;
  }
  try {
    const job = await startConversion(jobId, req.body, getRequestOwner(req, res));
    res.status(202).json(job);
  } catch (err: any) {
    if (err instanceof ConverterError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('Start conversion error:', err);
    res.status(500).json({ error: 'Failed to start conversion' });
  }
};

export const listJobsHandler = async (req: Request, res: Response) => {
  try {
    const jobs = await listJobs(getRequestOwner(req, res));
    res.json(jobs);
  } catch (err) {
    console.error('List jobs error:', err);
    res.status(500).json({ error: 'Failed to list conversion jobs' });
  }
};

export const statusHandler = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isValidJobId(id)) {
    res.status(400).json({ error: 'Invalid job id' });
    return;
  }
  try {
    const job = await getJobStatus(id, getRequestOwner(req, res));
    res.json(job);
  } catch (err: any) {
    if (err instanceof ConverterError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: 'Failed to fetch job status' });
  }
};

export const downloadHandler = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isValidJobId(id)) {
    res.status(400).json({ error: 'Invalid job id' });
    return;
  }
  try {
    const url = await getDownloadUrl(id, getRequestOwner(req, res));
    res.json({ url });
  } catch (err: any) {
    if (err instanceof ConverterError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: 'Failed to download converted file' });
  }
};

export const deleteHandler = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isValidJobId(id)) {
    res.status(400).json({ error: 'Invalid job id' });
    return;
  }
  try {
    await deleteJob(id, getRequestOwner(req, res));
    res.status(204).send();
  } catch (err: any) {
    if (err instanceof ConverterError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: 'Failed to delete job' });
  }
};

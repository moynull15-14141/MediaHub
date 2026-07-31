import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getRequestOwner } from '../lib/auth-helpers';
import { getImageInputDir, getImageJobDir, isValidImageJobId } from '../lib/image-paths';
import {
  createImageJobFromUpload,
  parseImageProcessOptions,
  processImageJob,
  getImageMetadataForJob,
  listImageJobs,
  getImageDownloadUrl,
  deleteImageJob,
  ImageError,
} from '../services/image.service';

const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.bmp', '.tiff', '.tif', '.gif', '.heic', '.heif']);
const ALLOWED_MIME_PREFIXES = ['image/', 'application/octet-stream'];
const MAX_UPLOAD_MB = Number(process.env.IMAGE_MAX_UPLOAD_MB) || 50;

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const jobId = (req as any).jobId as string;
    const dir = getImageInputDir(jobId);
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

// The watermark image (if provided) rides in the same request as /process,
// but doesn't belong to a job of its own - it's staged under the target
// job's own directory and deleted along with everything else afterward.
const watermarkStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const jobId = (req.body?.jobId as string) || 'unknown';
    const dir = getImageInputDir(jobId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, `watermark${ext}`);
  },
});

export const processUploadMiddleware = multer({
  storage: watermarkStorage,
  fileFilter,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
}).fields([{ name: 'watermarkImage', maxCount: 1 }]);

export const stampJobId = (req: Request, _res: Response, next: NextFunction) => {
  (req as any).jobId = crypto.randomUUID();
  next();
};

export const handleUploadError = (err: any, req: Request, res: Response, _next: NextFunction) => {
  const jobId = (req as any).jobId as string | undefined;
  if (jobId) {
    fs.rm(getImageJobDir(jobId), { recursive: true, force: true }, () => {});
  }
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: `File exceeds the ${MAX_UPLOAD_MB}MB upload limit` });
    return;
  }
  if (err.message === 'UNSUPPORTED_FILE_TYPE') {
    res.status(400).json({ error: 'Unsupported file type. Allowed: png, jpg, jpeg, webp, avif, bmp, tiff, gif, heic' });
    return;
  }
  console.error('Image upload error:', err);
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
    const job = await createImageJobFromUpload(
      { jobId, originalFilename: file.originalname.slice(0, 255), inputExt: ext, fileSizeBytes: file.size },
      getRequestOwner(req, res),
    );
    res.status(201).json(job);
  } catch (err: any) {
    console.error('Image job creation error:', err);
    res.status(400).json({ error: 'The uploaded file is not a valid image or is corrupted' });
  }
};

export const processHandler = async (req: Request, res: Response) => {
  const { jobId } = req.body || {};
  if (!jobId || typeof jobId !== 'string' || !isValidImageJobId(jobId)) {
    res.status(400).json({ error: 'Invalid or missing jobId' });
    return;
  }
  try {
    const options = parseImageProcessOptions(req.body);
    const watermarkFile = (req.files as Record<string, Express.Multer.File[]> | undefined)?.watermarkImage?.[0];
    const job = await processImageJob(jobId, options, getRequestOwner(req, res), watermarkFile?.path);
    res.status(200).json(job);
  } catch (err: any) {
    if (err instanceof ImageError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('Image process error:', err);
    res.status(500).json({ error: 'Failed to process image' });
  }
};

export const metadataHandler = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isValidImageJobId(id)) {
    res.status(400).json({ error: 'Invalid job id' });
    return;
  }
  try {
    const metadata = await getImageMetadataForJob(id, getRequestOwner(req, res));
    res.json(metadata);
  } catch (err: any) {
    if (err instanceof ImageError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('Image metadata error:', err);
    res.status(500).json({ error: 'Failed to read image metadata' });
  }
};

export const listJobsHandler = async (req: Request, res: Response) => {
  try {
    const jobs = await listImageJobs(getRequestOwner(req, res));
    res.json(jobs);
  } catch (err) {
    console.error('List image jobs error:', err);
    res.status(500).json({ error: 'Failed to list image jobs' });
  }
};

export const downloadHandler = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isValidImageJobId(id)) {
    res.status(400).json({ error: 'Invalid job id' });
    return;
  }
  try {
    const url = await getImageDownloadUrl(id, getRequestOwner(req, res));
    res.json({ url });
  } catch (err: any) {
    if (err instanceof ImageError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: 'Failed to download processed image' });
  }
};

export const deleteHandler = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isValidImageJobId(id)) {
    res.status(400).json({ error: 'Invalid job id' });
    return;
  }
  try {
    await deleteImageJob(id, getRequestOwner(req, res));
    res.status(204).send();
  } catch (err: any) {
    if (err instanceof ImageError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: 'Failed to delete job' });
  }
};

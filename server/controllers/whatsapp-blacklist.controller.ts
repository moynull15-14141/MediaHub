import { Request, Response } from 'express';
import multer from 'multer';
import { getUserId } from '../lib/require-auth';
import {
  listBlacklist,
  addToBlacklist,
  bulkDelete,
  deleteOne,
  importCsv,
  exportCsv,
  BlacklistError,
} from '../services/whatsapp-blacklist.service';

const handleBlacklistError = (err: any, res: Response, fallback: string) => {
  if (err instanceof BlacklistError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(fallback, err);
  res.status(500).json({ error: fallback });
};

export const listHandler = async (req: Request, res: Response) => {
  try {
    const { search, reason, page, pageSize } = req.query;
    const result = await listBlacklist(getUserId(req), {
      search: typeof search === 'string' ? search : undefined,
      reason: typeof reason === 'string' ? reason : undefined,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
    res.json(result);
  } catch (err) {
    handleBlacklistError(err, res, 'Failed to list blacklist');
  }
};

export const createHandler = async (req: Request, res: Response) => {
  try {
    const entry = await addToBlacklist(getUserId(req), req.body);
    res.status(201).json(entry);
  } catch (err) {
    handleBlacklistError(err, res, 'Failed to add to blacklist');
  }
};

export const deleteHandler = async (req: Request, res: Response) => {
  try {
    await deleteOne(getUserId(req), req.params.id);
    res.status(204).send();
  } catch (err) {
    handleBlacklistError(err, res, 'Failed to delete entry');
  }
};

export const bulkDeleteHandler = async (req: Request, res: Response) => {
  try {
    const result = await bulkDelete(getUserId(req), req.body?.ids);
    res.json(result);
  } catch (err) {
    handleBlacklistError(err, res, 'Failed to bulk delete');
  }
};

const ALLOWED_EXTENSIONS = new Set(['.csv']);
export const importUploadMiddleware = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      cb(new Error('UNSUPPORTED_FILE_TYPE'));
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 },
}).single('file');

export const handleImportUploadError = (err: any, _req: Request, res: Response, _next: any) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'File exceeds the 10MB upload limit' });
    return;
  }
  if (err?.message === 'UNSUPPORTED_FILE_TYPE') {
    res.status(400).json({ error: 'Unsupported file type. Upload a .csv file.' });
    return;
  }
  console.error('Blacklist import upload error:', err);
  res.status(500).json({ error: 'Upload failed' });
};

export const importHandler = async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  try {
    const result = await importCsv(getUserId(req), req.file.buffer);
    res.json(result);
  } catch (err) {
    handleBlacklistError(err, res, 'Failed to import blacklist');
  }
};

export const exportHandler = async (req: Request, res: Response) => {
  try {
    const csv = await exportCsv(getUserId(req));
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="blacklist.csv"');
    res.send(csv);
  } catch (err) {
    handleBlacklistError(err, res, 'Failed to export blacklist');
  }
};

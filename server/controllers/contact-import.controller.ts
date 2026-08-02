import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import { getUserId } from '../lib/require-auth';
import { parseImportFile, validateRows, commitImport, ContactImportError, ImportRow } from '../services/contact-import.service';

const ALLOWED_EXTENSIONS = new Set(['.csv', '.xlsx', '.xls']);
const MAX_UPLOAD_MB = Number(process.env.WHATSAPP_IMPORT_MAX_UPLOAD_MB) || 10;

const fileFilter: NonNullable<multer.Options['fileFilter']> = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    cb(new Error('UNSUPPORTED_FILE_TYPE'));
    return;
  }
  cb(null, true);
};

export const importUploadMiddleware = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
}).single('file');

export const handleImportUploadError = (err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: `File exceeds the ${MAX_UPLOAD_MB}MB upload limit` });
    return;
  }
  if (err?.message === 'UNSUPPORTED_FILE_TYPE') {
    res.status(400).json({ error: 'Unsupported file type. Upload a .csv or .xlsx file.' });
    return;
  }
  console.error('Contact import upload error:', err);
  res.status(500).json({ error: 'Upload failed' });
};

export const previewHandler = async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  try {
    const { source, rows: rawRows } = parseImportFile(file.buffer, file.originalname);
    const preview = await validateRows(getUserId(req), rawRows);
    res.json({ ...preview, source, filename: file.originalname });
  } catch (err) {
    if (err instanceof ContactImportError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('Contact import preview error:', err);
    res.status(500).json({ error: 'Failed to parse the uploaded file' });
  }
};

export const commitHandler = async (req: Request, res: Response) => {
  const { rows, filename, source } = req.body || {};
  if (!Array.isArray(rows)) {
    res.status(400).json({ error: 'rows must be the array returned by the preview step' });
    return;
  }
  if (source !== 'CSV' && source !== 'XLSX') {
    res.status(400).json({ error: 'Invalid source' });
    return;
  }
  try {
    const result = await commitImport(getUserId(req), rows as ImportRow[], {
      filename: typeof filename === 'string' ? filename.slice(0, 255) : undefined,
      source,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof ContactImportError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('Contact import commit error:', err);
    res.status(500).json({ error: 'Failed to import contacts' });
  }
};

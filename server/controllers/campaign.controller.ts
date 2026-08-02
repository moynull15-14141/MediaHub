import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { getUserId } from '../lib/require-auth';
import { getWorkspaceId } from '../lib/require-workspace';
import { getCampaignAttachmentDir, isValidCampaignId } from '../lib/whatsapp-campaign-paths';
import {
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  duplicateCampaign,
  updateCampaignStatus,
  CampaignError,
} from '../services/campaign.service';
import {
  setAttachment,
  removeAttachment,
  applyDefaultAttachment,
  ALL_ALLOWED_EXTENSIONS,
  MAX_UPLOAD_MB,
  CampaignAttachmentError,
} from '../services/campaign-attachment.service';

const handleCampaignError = (err: any, res: Response, fallback: string) => {
  if (err instanceof CampaignError || err instanceof CampaignAttachmentError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(fallback, err);
  res.status(500).json({ error: fallback });
};

export const listHandler = async (req: Request, res: Response) => {
  try {
    const { page, pageSize, search, status } = req.query;
    const result = await listCampaigns(getWorkspaceId(req), {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      search: typeof search === 'string' ? search : undefined,
      status: typeof status === 'string' ? status : undefined,
    });
    res.json(result);
  } catch (err) {
    handleCampaignError(err, res, 'Failed to list campaigns');
  }
};

export const getHandler = async (req: Request, res: Response) => {
  try {
    const campaign = await getCampaign(getWorkspaceId(req), req.params.id);
    res.json(campaign);
  } catch (err) {
    handleCampaignError(err, res, 'Failed to load campaign');
  }
};

export const createHandler = async (req: Request, res: Response) => {
  try {
    const campaign = await createCampaign(getWorkspaceId(req), getUserId(req), req.body);
    res.status(201).json(campaign);
  } catch (err) {
    handleCampaignError(err, res, 'Failed to create campaign');
  }
};

export const updateHandler = async (req: Request, res: Response) => {
  try {
    const campaign = await updateCampaign(getWorkspaceId(req), req.params.id, req.body);
    res.json(campaign);
  } catch (err) {
    handleCampaignError(err, res, 'Failed to update campaign');
  }
};

export const deleteHandler = async (req: Request, res: Response) => {
  try {
    await deleteCampaign(getWorkspaceId(req), req.params.id);
    res.status(204).send();
  } catch (err) {
    handleCampaignError(err, res, 'Failed to delete campaign');
  }
};

export const duplicateHandler = async (req: Request, res: Response) => {
  try {
    const campaign = await duplicateCampaign(getWorkspaceId(req), getUserId(req), req.params.id);
    res.status(201).json(campaign);
  } catch (err) {
    handleCampaignError(err, res, 'Failed to duplicate campaign');
  }
};

export const updateStatusHandler = async (req: Request, res: Response) => {
  try {
    const campaign = await updateCampaignStatus(getWorkspaceId(req), req.params.id, req.body?.status);
    res.json(campaign);
  } catch (err) {
    handleCampaignError(err, res, 'Failed to update campaign status');
  }
};

export const validateCampaignIdParam = (req: Request, res: Response, next: NextFunction) => {
  if (!isValidCampaignId(req.params.id)) {
    res.status(400).json({ error: 'Invalid campaign id' });
    return;
  }
  next();
};

const attachmentStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = getCampaignAttachmentDir(req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `upload${ext}`);
  },
});

const attachmentFileFilter: NonNullable<multer.Options['fileFilter']> = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALL_ALLOWED_EXTENSIONS.has(ext)) {
    cb(new Error('UNSUPPORTED_FILE_TYPE'));
    return;
  }
  cb(null, true);
};

export const attachmentUploadMiddleware = multer({
  storage: attachmentStorage,
  fileFilter: attachmentFileFilter,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
}).single('file');

export const handleAttachmentUploadError = (err: any, req: Request, res: Response, _next: NextFunction) => {
  const campaignId = req.params.id;
  if (campaignId) {
    fs.rm(getCampaignAttachmentDir(campaignId), { recursive: true, force: true }, () => {});
  }
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: `File exceeds the ${MAX_UPLOAD_MB}MB upload limit` });
    return;
  }
  if (err.message === 'UNSUPPORTED_FILE_TYPE') {
    res.status(400).json({ error: 'Unsupported attachment type. Allowed: jpg, jpeg, png, mp4, 3gp, pdf, doc, docx, xls, xlsx, ppt, pptx, txt, csv' });
    return;
  }
  console.error('Campaign attachment upload error:', err);
  res.status(500).json({ error: 'Upload failed' });
};

export const attachmentUploadHandler = async (req: Request, res: Response) => {
  const file = req.file;
  const campaignId = req.params.id;
  if (!file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  try {
    const ext = path.extname(file.originalname).toLowerCase();
    const attachment = await setAttachment(getWorkspaceId(req), campaignId, {
      localPath: file.path,
      originalFilename: file.originalname.slice(0, 255),
      ext,
      mimeType: file.mimetype,
      fileSizeBytes: file.size,
    });
    res.status(201).json(attachment);
  } catch (err) {
    handleCampaignError(err, res, 'Failed to attach file');
  } finally {
    fs.rm(getCampaignAttachmentDir(campaignId), { recursive: true, force: true }, () => {});
  }
};

export const attachmentRemoveHandler = async (req: Request, res: Response) => {
  try {
    await removeAttachment(getWorkspaceId(req), req.params.id);
    res.status(204).send();
  } catch (err) {
    handleCampaignError(err, res, 'Failed to remove attachment');
  }
};

export const applyDefaultAttachmentHandler = async (req: Request, res: Response) => {
  try {
    const attachment = await applyDefaultAttachment(getWorkspaceId(req), req.params.id);
    res.json(attachment);
  } catch (err) {
    handleCampaignError(err, res, 'Failed to apply default attachment');
  }
};

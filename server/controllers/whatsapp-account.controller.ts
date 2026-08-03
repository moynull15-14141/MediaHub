import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { getUserId } from '../lib/require-auth';
import { getWorkspaceId } from '../lib/require-workspace';
import {
  connectAccount,
  getAccount,
  disconnectAccount,
  refreshConnection,
  updateAccountSettings,
  rotateToken,
  getSecurityInfo,
  getWebhookMonitor,
  uploadLogo,
  removeLogo,
  uploadDefaultAttachment,
  removeDefaultAttachment,
  setDefaultAccount,
  setAccountPriority,
  setSendingEnabled,
  getTokenStatus,
  resumeAccount,
  WhatsappAccountError,
} from '../services/whatsapp-account.service';
import { getApiHealth } from '../services/api-health.service';
import { getSystemHealth } from '../services/system-health.service';
import { listAuditLogs, listHealthHistory } from '../services/whatsapp-audit.service';

const handleAccountError = (err: any, res: Response, fallback: string) => {
  if (err instanceof WhatsappAccountError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(fallback, err);
  res.status(500).json({ error: fallback });
};

export const connectHandler = async (req: Request, res: Response) => {
  try {
    const account = await connectAccount(getWorkspaceId(req), getUserId(req), req.body);
    res.status(201).json(account);
  } catch (err) {
    handleAccountError(err, res, 'Failed to connect WhatsApp account');
  }
};

export const getAccountHandler = async (req: Request, res: Response) => {
  try {
    const account = await getAccount(getUserId(req));
    res.json(account);
  } catch (err) {
    handleAccountError(err, res, 'Failed to load WhatsApp account');
  }
};

export const disconnectHandler = async (req: Request, res: Response) => {
  try {
    await disconnectAccount(getUserId(req));
    res.status(204).send();
  } catch (err) {
    handleAccountError(err, res, 'Failed to disconnect WhatsApp account');
  }
};

export const refreshHandler = async (req: Request, res: Response) => {
  try {
    const account = await refreshConnection(getUserId(req));
    res.json(account);
  } catch (err) {
    handleAccountError(err, res, 'Failed to refresh WhatsApp connection');
  }
};

export const updateSettingsHandler = async (req: Request, res: Response) => {
  try {
    const account = await updateAccountSettings(getUserId(req), req.body);
    res.json(account);
  } catch (err) {
    handleAccountError(err, res, 'Failed to update settings');
  }
};

export const rotateTokenHandler = async (req: Request, res: Response) => {
  try {
    const account = await rotateToken(getUserId(req), req.body);
    res.json(account);
  } catch (err) {
    handleAccountError(err, res, 'Failed to rotate token');
  }
};

export const securityInfoHandler = async (req: Request, res: Response) => {
  try {
    const info = await getSecurityInfo(getUserId(req));
    res.json(info);
  } catch (err) {
    handleAccountError(err, res, 'Failed to load security info');
  }
};

export const webhookMonitorHandler = async (req: Request, res: Response) => {
  try {
    const monitor = await getWebhookMonitor(getUserId(req));
    res.json(monitor);
  } catch (err) {
    handleAccountError(err, res, 'Failed to load webhook monitor');
  }
};

export const apiHealthHandler = async (req: Request, res: Response) => {
  try {
    const health = await getApiHealth(getUserId(req));
    res.json(health);
  } catch (err) {
    handleAccountError(err, res, 'Failed to load API health');
  }
};

export const systemHealthHandler = async (req: Request, res: Response) => {
  try {
    const cards = await getSystemHealth(getUserId(req));
    res.json({ cards });
  } catch (err) {
    handleAccountError(err, res, 'Failed to load system health');
  }
};

export const auditLogsHandler = async (req: Request, res: Response) => {
  try {
    const { page, pageSize } = req.query;
    const result = await listAuditLogs(getUserId(req), {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
    res.json(result);
  } catch (err) {
    handleAccountError(err, res, 'Failed to load audit logs');
  }
};

// Phase B.3 - Token Lifecycle Automation
export const tokenStatusHandler = async (req: Request, res: Response) => {
  try {
    const status = await getTokenStatus(getUserId(req));
    res.json(status);
  } catch (err) {
    handleAccountError(err, res, 'Failed to load token status');
  }
};

export const resumeAccountHandler = async (req: Request, res: Response) => {
  try {
    const result = await resumeAccount(getUserId(req));
    res.json(result);
  } catch (err) {
    handleAccountError(err, res, 'Failed to resume campaigns');
  }
};

export const healthHistoryHandler = async (req: Request, res: Response) => {
  try {
    const { page, pageSize } = req.query;
    const result = await listHealthHistory(getUserId(req), {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
    res.json(result);
  } catch (err) {
    handleAccountError(err, res, 'Failed to load health history');
  }
};

// Phase B.2 - act on ANY account in the workspace by id (route params), not
// just the caller's own - legitimate because these routes are gated by
// requireWorkspaceRole('ADMIN'), not the self-scoped settings:* permission.
export const setDefaultAccountHandler = async (req: Request, res: Response) => {
  try {
    const account = await setDefaultAccount(getWorkspaceId(req), getUserId(req), req.params.accountId);
    res.json(account);
  } catch (err) {
    handleAccountError(err, res, 'Failed to set default account');
  }
};

export const setSendingEnabledHandler = async (req: Request, res: Response) => {
  try {
    const account = await setSendingEnabled(getWorkspaceId(req), getUserId(req), req.params.accountId, Boolean(req.body?.enabled));
    res.json(account);
  } catch (err) {
    handleAccountError(err, res, 'Failed to update sending status');
  }
};

export const setPriorityHandler = async (req: Request, res: Response) => {
  try {
    const account = await setAccountPriority(getWorkspaceId(req), getUserId(req), req.params.accountId, Number(req.body?.priority));
    res.json(account);
  } catch (err) {
    handleAccountError(err, res, 'Failed to update priority');
  }
};

const ALLOWED_LOGO_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg']);
export const logoUploadMiddleware = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
    if (!ALLOWED_LOGO_EXTENSIONS.has(ext)) {
      cb(new Error('UNSUPPORTED_FILE_TYPE'));
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: 2 * 1024 * 1024 },
}).single('file');

export const handleLogoUploadError = (err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'Logo exceeds the 2MB size limit' });
    return;
  }
  if (err?.message === 'UNSUPPORTED_FILE_TYPE') {
    res.status(400).json({ error: 'Unsupported logo type. Use PNG, JPEG, WEBP, or SVG.' });
    return;
  }
  console.error('Logo upload error:', err);
  res.status(500).json({ error: 'Upload failed' });
};

export const logoUploadHandler = async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  try {
    const result = await uploadLogo(getUserId(req), {
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
    });
    res.status(201).json(result);
  } catch (err) {
    handleAccountError(err, res, 'Failed to upload logo');
  }
};

export const logoRemoveHandler = async (req: Request, res: Response) => {
  try {
    await removeLogo(getUserId(req));
    res.status(204).send();
  } catch (err) {
    handleAccountError(err, res, 'Failed to remove logo');
  }
};

const DEFAULT_ATTACHMENT_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.mp4', '.3gp', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv']);
export const defaultAttachmentUploadMiddleware = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
    if (!DEFAULT_ATTACHMENT_EXTENSIONS.has(ext)) {
      cb(new Error('UNSUPPORTED_FILE_TYPE'));
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: 100 * 1024 * 1024 },
}).single('file');

export const handleDefaultAttachmentUploadError = (err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'File exceeds the upload limit' });
    return;
  }
  if (err?.message === 'UNSUPPORTED_FILE_TYPE') {
    res.status(400).json({ error: 'Unsupported attachment type' });
    return;
  }
  console.error('Default attachment upload error:', err);
  res.status(500).json({ error: 'Upload failed' });
};

export const defaultAttachmentUploadHandler = async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  try {
    const ext = req.file.originalname.toLowerCase().slice(req.file.originalname.lastIndexOf('.'));
    const result = await uploadDefaultAttachment(getUserId(req), {
      buffer: req.file.buffer,
      originalFilename: req.file.originalname.slice(0, 255),
      ext,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
    });
    res.status(201).json(result);
  } catch (err) {
    handleAccountError(err, res, 'Failed to upload default attachment');
  }
};

export const defaultAttachmentRemoveHandler = async (req: Request, res: Response) => {
  try {
    await removeDefaultAttachment(getUserId(req));
    res.status(204).send();
  } catch (err) {
    handleAccountError(err, res, 'Failed to remove default attachment');
  }
};

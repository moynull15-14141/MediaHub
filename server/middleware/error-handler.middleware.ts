import { Request, Response, NextFunction } from 'express';
import { errorLogger } from '../lib/logger';
import { config } from '../lib/config';

// Centralized error handler (Phase A.4, Part 12) - a safety net, not a
// replacement for the existing per-controller try/catch + local
// handleXError() pattern (ContactError, CampaignError, WhatsappAccountError,
// PermissionError, PdfError, ImageError, ...) that already runs first in
// every controller. Every one of those custom error classes already follows
// the same shape (`status: number` on the Error), so this handler
// recognizes them for free without importing or special-casing each one -
// it only actually does something new for the cases those don't cover:
// uncaught synchronous throws, and explicit next(err) calls.
type ErrorCategory = 'validation' | 'authentication' | 'authorization' | 'not_found' | 'business' | 'database' | 'external_api' | 'internal';

const categorize = (status: number): ErrorCategory => {
  if (status === 400) return 'validation';
  if (status === 401) return 'authentication';
  if (status === 403) return 'authorization';
  if (status === 404) return 'not_found';
  if (status === 409 || status === 422) return 'business';
  if (status === 502 || status === 503 || status === 504) return 'external_api';
  if (status >= 400 && status < 500) return 'validation';
  return 'internal';
};

export const errorHandlerMiddleware = (err: any, req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;

  const status = typeof err?.status === 'number' ? err.status : 500;
  const category = categorize(status);
  const isPrismaError = typeof err?.code === 'string' && err.code.startsWith('P');
  const finalCategory = isPrismaError ? 'database' : category;
  const finalStatus = isPrismaError ? 500 : status;

  errorLogger.error(err?.message || 'Unhandled error', {
    category: finalCategory,
    status: finalStatus,
    path: req.path,
    method: req.method,
    stack: config.isProduction ? undefined : err?.stack,
  });

  // Never leak internals (stack traces, Prisma error detail, raw DB errors)
  // in production - only known, intentionally-thrown business errors (status
  // < 500) get their message forwarded to the client as-is.
  const message = finalStatus < 500 || !config.isProduction ? err?.message || 'An error occurred' : 'Internal server error';

  res.status(finalStatus).json({ error: message, category: finalCategory });
};

export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({ error: `No route: ${req.method} ${req.path}`, category: 'not_found' });
};

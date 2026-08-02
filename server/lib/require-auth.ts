import { Request, Response, NextFunction } from 'express';
import { verifyAuthToken } from '../services/user.service';

// Unlike other modules (converter/image/pdf), which support anonymous
// visitors via a cookie, WhatsApp Campaign manages a real business account
// and contact data, so it always requires a logged-in user.
export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }
  const payload = verifyAuthToken(header.slice(7));
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
  (req as any).userId = payload.sub;
  next();
};

export const getUserId = (req: Request): string => (req as any).userId as string;

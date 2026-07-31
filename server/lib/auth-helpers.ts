import { Request } from 'express';
import { verifyAuthToken } from '../services/user.service';

export const getOptionalUserId = (req: Request): string | undefined => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  const payload = verifyAuthToken(header.slice(7));
  return payload?.sub;
};

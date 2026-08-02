import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

// CSRF protection (Phase A.4, Part 6), scoped to the two endpoints that are
// authenticated purely by an ambient cookie: /api/auth/refresh and
// /api/auth/logout (see auth.controller.ts). Every other write endpoint in
// this app requires an Authorization: Bearer header, which a cross-site page
// cannot make the browser attach automatically the way it does a cookie -
// classic CSRF doesn't apply to those, so blanket-applying this everywhere
// would be following the letter of "protect all write endpoints" while
// missing why CSRF protection exists in the first place.
//
// Double-submit-cookie pattern: the token lives in a readable (non-HttpOnly)
// cookie, set alongside the HttpOnly refresh cookie. A malicious cross-origin
// page can trigger a request that carries the refresh cookie automatically,
// but - because this app's CORS policy reflects any origin with credentials
// enabled (needed for the Vercel-frontend/self-hosted-backend split
// deployment) - the browser's same-origin cookie isolation is the only thing
// stopping that page from also reading mh_csrf_token and forging a matching
// header, since CORS alone doesn't gate that here.
export const CSRF_COOKIE_NAME = 'mh_csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';

export const generateCsrfToken = (): string => crypto.randomBytes(24).toString('base64url');

export const setCsrfCookie = (res: Response, token: string, path: string, maxAgeMs: number): void => {
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    secure: true,
    sameSite: 'none',
    path,
    maxAge: maxAgeMs,
  });
};

export const clearCsrfCookie = (res: Response, path: string): void => {
  res.clearCookie(CSRF_COOKIE_NAME, { path });
};

export const requireCsrfToken = (req: Request, res: Response, next: NextFunction): void => {
  const header = req.headers[CSRF_HEADER_NAME];
  const cookies = req.headers.cookie || '';
  const match = cookies.match(new RegExp(`${CSRF_COOKIE_NAME}=([^;]+)`));
  const cookieToken = match ? decodeURIComponent(match[1]) : undefined;

  if (!header || !cookieToken || header !== cookieToken) {
    res.status(403).json({ error: 'Invalid or missing CSRF token' });
    return;
  }
  next();
};

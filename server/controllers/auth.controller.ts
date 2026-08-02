import { Request, Response } from 'express';
import {
  registerUser,
  verifyUserCredentials,
  createAuthToken,
  verifyAuthToken,
  setUserCookies,
  findUserById,
  createRefreshToken,
  verifyAndRotateRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokensForUser,
  tokenLifetimeSeconds,
} from '../services/user.service';
import { recordAuthEvent, isLockedOut, listLoginHistory } from '../services/auth-log.service';
import { config } from '../lib/config';
import { generateCsrfToken, setCsrfCookie, clearCsrfCookie } from '../middleware/csrf.middleware';

const REFRESH_COOKIE_NAME = 'mh_refresh_token';
const REFRESH_COOKIE_PATH = '/api/auth';

// Refresh token lives in an HttpOnly cookie - never readable by client JS, so
// an XSS bug can't exfiltrate it the way a localStorage value could. The
// short-lived access token stays in the existing Bearer-header flow
// unchanged, so no other module's fetch calls need to change. A CSRF token
// is issued alongside it in a separate, readable cookie (see
// csrf.middleware.ts for why refresh/logout specifically need this) -
// scoped to path "/" rather than REFRESH_COOKIE_PATH, since document.cookie
// read access in the browser is gated by the *page's* path, not the
// request's target path. AuthContext.tsx runs on every route of this SPA
// (/, /whatsapp/*, ...), none of which fall under /api/auth, so a cookie
// scoped there would never actually be readable by the frontend JS that
// needs to send it back as the X-CSRF-Token header.
const setRefreshCookie = (res: Response, token: string) => {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: REFRESH_COOKIE_PATH,
    maxAge: tokenLifetimeSeconds * 1000,
  });
  setCsrfCookie(res, generateCsrfToken(), '/', tokenLifetimeSeconds * 1000);
};

const clearRefreshCookie = (res: Response) => {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  clearCsrfCookie(res, '/');
};

const parseCookies = (req: Request): Record<string, string> => {
  const header = req.headers.cookie;
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    result[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return result;
};

export const register = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const user = await registerUser(email, password);
    const token = createAuthToken(user);
    const refreshToken = await createRefreshToken(user.id);
    setRefreshCookie(res, refreshToken);
    void recordAuthEvent(req, 'REGISTER', user.email, user.id);
    res.json({ token, user: { id: user.id, email: user.email, createdAt: user.createdAt } });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Registration failed' });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (typeof email !== 'string' || !email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Brute Force Protection (Phase A.4) - checked before touching the
    // password hash at all, so a lockout can't be used to fingerprint
    // whether an account exists via timing.
    if (await isLockedOut(email, config.bruteForce.maxFailedAttempts, config.bruteForce.lockoutMs)) {
      void recordAuthEvent(req, 'LOGIN_FAILED', email, undefined, 'locked_out');
      return res.status(429).json({ error: 'Too many failed login attempts. Try again later.' });
    }

    const user = await verifyUserCredentials(email, password);
    if (!user) {
      void recordAuthEvent(req, 'LOGIN_FAILED', email, undefined, 'invalid_credentials');
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = createAuthToken(user);
    const refreshToken = await createRefreshToken(user.id);
    setRefreshCookie(res, refreshToken);
    void recordAuthEvent(req, 'LOGIN', user.email, user.id);
    res.json({ token, user: { id: user.id, email: user.email, createdAt: user.createdAt } });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Login failed' });
  }
};

export const whoami = async (req: Request, res: Response) => {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }
  const token = authorization.split(' ')[1];
  const payload = verifyAuthToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const user = await findUserById(payload.sub);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }

  res.json({ user: { id: user.id, email: user.email, createdAt: user.createdAt, cookieUploadedAt: user.cookieUploadedAt } });
};

// Exchanges the HttpOnly refresh cookie for a fresh access token, rotating
// the refresh token in the same call. The frontend calls this silently
// (AuthContext) whenever the 15-minute access token has expired, so a login
// keeps a user signed in for as long as the refresh token is valid without
// ever showing the login screen again.
export const refresh = async (req: Request, res: Response) => {
  const rawToken = parseCookies(req)[REFRESH_COOKIE_NAME];
  if (!rawToken) {
    return res.status(401).json({ error: 'No refresh token' });
  }

  const result = await verifyAndRotateRefreshToken(rawToken);
  if (!result) {
    clearRefreshCookie(res);
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }

  setRefreshCookie(res, result.refreshToken);
  const token = createAuthToken(result.user);
  void recordAuthEvent(req, 'TOKEN_REFRESH', result.user.email, result.user.id);
  res.json({ token, user: { id: result.user.id, email: result.user.email, createdAt: result.user.createdAt } });
};

export const logout = async (req: Request, res: Response) => {
  const rawToken = parseCookies(req)[REFRESH_COOKIE_NAME];
  if (rawToken) {
    await revokeRefreshToken(rawToken);
  }
  clearRefreshCookie(res);
  const authorization = req.headers.authorization;
  const payload = authorization?.startsWith('Bearer ') ? verifyAuthToken(authorization.slice(7)) : null;
  if (payload) void recordAuthEvent(req, 'LOGOUT', payload.email, payload.sub);
  res.json({ status: 'ok' });
};

export const logoutAll = async (req: Request, res: Response) => {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }
  const payload = verifyAuthToken(authorization.split(' ')[1]);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const revokedCount = await revokeAllRefreshTokensForUser(payload.sub);
  clearRefreshCookie(res);
  void recordAuthEvent(req, 'LOGOUT_ALL', payload.email, payload.sub);
  res.json({ status: 'ok', revokedCount });
};

export const loginHistoryHandler = async (req: Request, res: Response) => {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }
  const payload = verifyAuthToken(authorization.slice(7));
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  const history = await listLoginHistory(payload.sub, Number(req.query.limit) || 20);
  res.json(history);
};

export const uploadCookies = async (req: Request, res: Response) => {
  try {
    const authorization = req.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization token' });
    }
    const token = authorization.split(' ')[1];
    const payload = verifyAuthToken(token);
    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const rawCookieData = req.body.cookies;
    if (!rawCookieData || typeof rawCookieData !== 'string') {
      return res.status(400).json({ error: 'Cookie data is required' });
    }

    await setUserCookies(payload.sub, rawCookieData);
    res.json({ status: 'ok', message: 'Cookies uploaded successfully' });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Cookie upload failed' });
  }
};

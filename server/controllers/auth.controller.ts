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
  updateUserName,
  changeUserPassword,
  ProfileError,
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
//
// secure/sameSite are derived from the ACTUAL connection (req.secure, which
// correctly reflects X-Forwarded-Proto once trust proxy is set) rather than
// hardcoded - browsers silently refuse to store a `Secure` cookie at all
// over a plain http:// origin (this is standard, unconditional browser
// behavior, not a bug in this app). Hardcoding secure:true unconditionally
// meant the refresh/CSRF cookies were never actually stored when this app is
// served over plain HTTP (e.g. a local/self-hosted deployment with no TLS-
// terminating proxy in front) - every silent refresh then failed CSRF
// validation (missing cookie) with 403, the access token was never renewed,
// and every subsequent authenticated request failed with 401 once it expired.
// SameSite=None is only valid (and only needed, for a cross-origin
// frontend/backend split) when secure - same-origin http deployments use Lax.
const setRefreshCookie = (req: Request, res: Response, token: string) => {
  const secure = req.secure;
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: secure ? 'none' : 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: tokenLifetimeSeconds * 1000,
  });
  setCsrfCookie(res, generateCsrfToken(), '/', tokenLifetimeSeconds * 1000, secure);
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
    setRefreshCookie(req, res, refreshToken);
    void recordAuthEvent(req, 'REGISTER', user.email, user.id);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt } });
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
    setRefreshCookie(req, res, refreshToken);
    void recordAuthEvent(req, 'LOGIN', user.email, user.id);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt } });
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

  res.json({ user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt, cookieUploadedAt: user.cookieUploadedAt } });
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

  setRefreshCookie(req, res, result.refreshToken);
  const token = createAuthToken(result.user);
  void recordAuthEvent(req, 'TOKEN_REFRESH', result.user.email, result.user.id);
  res.json({ token, user: { id: result.user.id, email: result.user.email, name: result.user.name, createdAt: result.user.createdAt } });
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

const handleProfileError = (err: any, res: Response, fallback: string) => {
  if (err instanceof ProfileError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(fallback, err);
  res.status(500).json({ error: fallback });
};

export const updateProfileHandler = async (req: Request, res: Response) => {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }
  const payload = verifyAuthToken(authorization.slice(7));
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  try {
    const user = await updateUserName(payload.sub, req.body?.name);
    res.json({ id: user.id, email: user.email, name: user.name, createdAt: user.createdAt });
  } catch (err) {
    handleProfileError(err, res, 'Failed to update profile');
  }
};

export const changePasswordHandler = async (req: Request, res: Response) => {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }
  const payload = verifyAuthToken(authorization.slice(7));
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  try {
    await changeUserPassword(payload.sub, req.body?.currentPassword, req.body?.newPassword);
    void recordAuthEvent(req, 'PASSWORD_CHANGE', payload.email, payload.sub);
    res.json({ status: 'ok' });
  } catch (err) {
    handleProfileError(err, res, 'Failed to change password');
  }
};

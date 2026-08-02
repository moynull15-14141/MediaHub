import { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { config } from '../lib/config';
import { appLogger } from '../lib/logger';

// General API rate limiter (Part 5) - generous, meant to absorb runaway
// clients/bugs rather than throttle normal use. keyGenerator defaults to
// req.ip, which is only trustworthy once trust proxy is set (see below).
export const apiRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// Tighter limiter specifically for /api/auth/login and /register - these are
// the brute-force/credential-stuffing/signup-spam targets. Layered on top of
// (not instead of) the DB-backed per-email lockout in auth-log.service.ts:
// this one is per-IP and catches distributed-username attacks that lockout
// alone wouldn't (different email each attempt, same IP).
export const authRateLimiter = rateLimit({
  windowMs: config.rateLimit.authWindowMs,
  limit: config.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

// contentSecurityPolicy is deliberately off: this app was never built against
// a CSP (inline styles/scripts from Vite's dev/prod bundles are untested
// against one), and shipping an untuned CSP risks silently breaking asset
// loading in production with no local repro. Every other Helmet default
// (X-Frame-Options, X-Content-Type-Options, HSTS, etc.) stays on.
export const securityHeaders = helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false });

export const responseCompression = compression();

// Origin allowlist validation layered on top of the existing reflected-origin
// CORS handler in server.ts - a no-op (same reflect-any-origin behavior as
// before) unless CORS_ALLOWED_ORIGINS is set, so nothing changes for the
// current Vercel/self-hosted deployments until that's explicitly configured.
export const validateOrigin = (req: Request, res: Response, next: NextFunction) => {
  const { allowedOrigins } = config.cors;
  const origin = req.headers.origin;
  if (allowedOrigins.length > 0 && origin && !allowedOrigins.includes(origin)) {
    appLogger.warn('Blocked request from disallowed origin', { origin, path: req.path });
    res.status(403).json({ error: 'Origin not allowed' });
    return;
  }
  next();
};

export const applySecurityMiddleware = (app: Express): void => {
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.use(responseCompression);
  app.use('/api', apiRateLimiter);
};

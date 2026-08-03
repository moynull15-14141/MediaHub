import { Request, Response } from 'express';
import crypto from 'crypto';
import { verifyAuthToken } from '../services/user.service';

const ANON_COOKIE_NAME = 'mh_anon_id';
const ANON_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

export const getOptionalUserId = (req: Request): string | undefined => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  const payload = verifyAuthToken(header.slice(7));
  return payload?.sub;
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

export interface RequestOwner {
  userId?: string;
  anonId: string;
}

// Identifies who a converter job belongs to: a logged-in user's ID, or - for
// anonymous visitors - a random ID persisted in a long-lived cookie. A cookie
// is used instead of the client IP because many unrelated users share the
// same IP behind NAT/mobile carriers, which would leak each other's history.
export const getRequestOwner = (req: Request, res: Response): RequestOwner => {
  const userId = getOptionalUserId(req);

  let anonId = parseCookies(req)[ANON_COOKIE_NAME];
  if (!anonId) {
    anonId = crypto.randomUUID();
    // secure/sameSite derived from the real connection (req.secure, reflects
    // X-Forwarded-Proto once trust proxy is set - see security.middleware.ts)
    // rather than hardcoded. Browsers unconditionally refuse to store a
    // Secure cookie over a plain http:// origin - the previous "browsers
    // treat http://localhost as secure too" assumption only holds for the
    // literal hostname localhost/127.0.0.1 in some browsers, not for a LAN IP,
    // a custom local domain, or a self-hosted deployment without TLS in
    // front, so this cookie silently never got set (new visitors got a fresh
    // anonId - and lost their history - on every single request) in exactly
    // those cases. 'none' + secure is still used whenever the connection
    // really is HTTPS, which is what a cross-origin frontend/backend split
    // (Vercel + Render, etc) actually requires.
    const secure = req.secure;
    res.cookie(ANON_COOKIE_NAME, anonId, {
      maxAge: ANON_COOKIE_MAX_AGE_MS,
      httpOnly: true,
      sameSite: secure ? 'none' : 'lax',
      secure,
    });
  }

  return { userId, anonId };
};

export const ownerMatches = (record: { userId?: string | null; anonId?: string | null }, owner: RequestOwner): boolean =>
  owner.userId ? record.userId === owner.userId : !record.userId && record.anonId === owner.anonId;

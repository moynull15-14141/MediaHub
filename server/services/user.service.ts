import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { createWorkspaceForUserTx } from './workspace.service';

const cookiesDir = path.join(process.cwd(), 'server', 'data', 'cookies');
// Phase B.6 - CRITICAL FIX: the previous fallback was a hardcoded string
// ('mediahub-local-secret') visible in source. Live-verified during this
// audit: with JWT_SECRET unset, a token forged offline using that exact
// string was accepted by /api/auth/whoami as a fully valid session for a
// real user - a complete authentication bypass requiring no credentials,
// exploitable by anyone who has read this file. A random-per-process
// fallback preserves the original intent (never hard-fail startup just
// because JWT_SECRET is unset - see startup-validation.ts) while making
// that fallback unpredictable instead of a known constant. The tradeoff -
// every restart invalidates existing sessions when running without a real
// JWT_SECRET - only affects the exact deployments the startup warning
// already tells to set one before real production use.
const jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const BCRYPT_ROUNDS = 12;
const REFRESH_TOKEN_BYTES = 48;

// Access token: short-lived and stateless, verified on every request with no
// DB round-trip. Refresh token: long-lived and DB-backed (RefreshToken
// table), so it can actually be revoked - this is what session expiry and
// "log out everywhere" control. Also read by whatsapp-account.service.ts as
// the account's displayed "session timeout" default.
export const accessTokenLifetimeSeconds = 60 * 15;
export const tokenLifetimeSeconds = 60 * 60 * 24 * 30;

const ensureCookiesDir = () => {
  if (!fs.existsSync(cookiesDir)) {
    fs.mkdirSync(cookiesDir, { recursive: true });
  }
};

const base64Url = (value: string | Buffer) =>
  Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

const parseBase64Url = (value: string) =>
  Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

const getTokenSignature = (header: string, payload: string) => {
  return base64Url(
    crypto.createHmac('sha256', jwtSecret).update(`${header}.${payload}`).digest()
  );
};

// Legacy pbkdf2 verification, kept only to validate (and then auto-upgrade)
// rows migrated from the old server/data/users.json flat-file store. Every
// password hashed since the Postgres migration uses bcrypt exclusively -
// this branch is dead code for any user who has logged in even once since.
const verifyLegacyPbkdf2 = (password: string, salt: string, expectedHash: string): boolean => {
  const computed = crypto.pbkdf2Sync(password, salt, 310000, 32, 'sha256').toString('hex');
  return computed === expectedHash;
};

export const findUserByEmail = async (email: string) => {
  return prisma.user.findUnique({ where: { email: email.toLowerCase() } });
};

export const findUserById = async (id: string) => {
  return prisma.user.findUnique({ where: { id } });
};

export const registerUser = async (email: string, password: string) => {
  if (!email || !password) {
    throw new Error('Email and password are required.');
  }
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }

  const normalizedEmail = email.toLowerCase().trim();
  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    throw new Error('A user with that email already exists.');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // User + Workspace + OWNER membership as one atomic transaction (Phase
  // A.2, Part 2) - a failure partway through must never leave a user with
  // no workspace or a workspace with no owner.
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email: normalizedEmail, passwordHash } });
    await createWorkspaceForUserTx(tx, user.id, user.email);
    return user;
  });
};

export const verifyUserCredentials = async (email: string, password: string) => {
  const user = await findUserByEmail(email);
  if (!user) return null;

  if (user.salt) {
    // Legacy pbkdf2 row - verify the old way, then transparently upgrade to
    // bcrypt so this branch is never hit again for this user.
    if (!verifyLegacyPbkdf2(password, user.salt, user.passwordHash)) return null;
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    return prisma.user.update({ where: { id: user.id }, data: { passwordHash, salt: null } });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  return valid ? user : null;
};

export const createAuthToken = (user: { id: string; email: string }) => {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({ sub: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) + accessTokenLifetimeSeconds })
  );
  const signature = getTokenSignature(header, payload);
  return `${header}.${payload}.${signature}`;
};

export const verifyAuthToken = (token: string) => {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expected = getTokenSignature(header, payload);
  if (signature !== expected) return null;

  try {
    const parsed = JSON.parse(parseBase64Url(payload));
    if (typeof parsed.exp !== 'number' || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed as { sub: string; email: string; exp: number };
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Refresh tokens - long-lived, DB-backed, revocable. Only a hash is ever
// stored (mirroring password hashing), so a leaked database row can't be
// replayed as a live session. Rotated on every use: the presented token is
// revoked and a new one issued, so a stolen-and-replayed old token is a
// one-shot event rather than a standing key.
// ---------------------------------------------------------------------------

const hashRefreshToken = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex');

export const createRefreshToken = async (userId: string): Promise<string> => {
  const raw = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
  const tokenHash = hashRefreshToken(raw);
  const expiresAt = new Date(Date.now() + tokenLifetimeSeconds * 1000);
  await prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
  return raw;
};

export const verifyAndRotateRefreshToken = async (rawToken: string) => {
  const tokenHash = hashRefreshToken(rawToken);
  const record = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!record || record.revokedAt || record.expiresAt < new Date()) return null;

  const user = await findUserById(record.userId);
  if (!user) return null;

  await prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
  const refreshToken = await createRefreshToken(user.id);
  return { user, refreshToken };
};

export const revokeRefreshToken = async (rawToken: string): Promise<void> => {
  const tokenHash = hashRefreshToken(rawToken);
  await prisma.refreshToken.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } });
};

export const revokeAllRefreshTokensForUser = async (userId: string): Promise<number> => {
  const result = await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  return result.count;
};

// ---------------------------------------------------------------------------
// Profile - self-service account management (display name, password change).
// ---------------------------------------------------------------------------

export class ProfileError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const NAME_MAX = 100;

export const updateUserName = async (userId: string, name: unknown) => {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) throw new ProfileError('Name is required', 400);
  if (trimmed.length > NAME_MAX) throw new ProfileError(`Name must be ${NAME_MAX} characters or fewer`, 400);
  return prisma.user.update({ where: { id: userId }, data: { name: trimmed } });
};

// Requires the current password (not just an authenticated session) before
// accepting a new one - the standard defense against a stolen/left-open
// session being used to lock the real owner out by changing their password.
export const changeUserPassword = async (userId: string, currentPassword: string, newPassword: string) => {
  if (typeof currentPassword !== 'string' || !currentPassword) {
    throw new ProfileError('Current password is required', 400);
  }
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    throw new ProfileError('New password must be at least 8 characters', 400);
  }

  const user = await findUserById(userId);
  if (!user) throw new ProfileError('User not found', 404);

  const valid = user.salt
    ? verifyLegacyPbkdf2(currentPassword, user.salt, user.passwordHash)
    : await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) throw new ProfileError('Current password is incorrect', 401);

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash, salt: null } });
};

export const setUserCookies = async (userId: string, rawCookieData: string) => {
  const user = await findUserById(userId);
  if (!user) {
    throw new Error('User not found.');
  }

  ensureCookiesDir();
  const cookiePath = path.join(cookiesDir, `${userId}.txt`);
  fs.writeFileSync(cookiePath, rawCookieData, 'utf8');
  await prisma.user.update({ where: { id: userId }, data: { cookiePath, cookieUploadedAt: new Date() } });

  return cookiePath;
};

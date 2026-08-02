import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { config } from '../lib/config';
import { exchangeCodeForToken, ExchangedToken } from '../lib/whatsapp-graph';

export class MetaOAuthError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes - long enough for a real Facebook login, short enough to bound replay risk

export const getPublicMetaConfig = () => ({
  configured: config.meta.embeddedSignupConfigured,
  appId: config.meta.appId || null,
  configId: config.meta.configId || null,
  graphApiVersion: config.meta.graphApiVersion,
});

// Mints a single-use, workspace+user-scoped token the frontend must echo
// back with the callback (Part 3: "Prevent CSRF"). Unlike a redirect-based
// OAuth flow, FB.login's config_id popup never round-trips a `state` through
// Meta's servers, so this state is validated purely between our own frontend
// and backend - it still defeats CSRF because it is unguessable, tied to the
// authenticated session that minted it, and rejected if replayed.
export const createOAuthState = async (workspaceId: string, userId: string): Promise<string> => {
  const state = crypto.randomBytes(32).toString('base64url');
  // Opportunistic cleanup of this user's own expired attempts - keeps the
  // table bounded without a dedicated cleanup scheduler, at the cost of one
  // cheap indexed delete per new login attempt.
  await prisma.metaOAuthState.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } }).catch(() => {});
  await prisma.metaOAuthState.create({
    data: { state, workspaceId, userId, expiresAt: new Date(Date.now() + STATE_TTL_MS) },
  });
  return state;
};

// Atomically marks the state used (the `used: false` guard in the WHERE
// clause makes a concurrent double-submit lose the race instead of both
// succeeding) - Part 3: "Prevent replay attacks".
export const consumeOAuthState = async (state: string, workspaceId: string, userId: string): Promise<void> => {
  if (!state || typeof state !== 'string') throw new MetaOAuthError('Missing state parameter', 400);

  const record = await prisma.metaOAuthState.findUnique({ where: { state } });
  if (!record) throw new MetaOAuthError('Invalid or unknown state', 400);
  if (record.workspaceId !== workspaceId || record.userId !== userId) {
    throw new MetaOAuthError('State does not match the current workspace/user', 403);
  }
  if (record.used) throw new MetaOAuthError('This login attempt was already used', 409);
  if (record.expiresAt.getTime() < Date.now()) throw new MetaOAuthError('This login attempt has expired - please try again', 410);

  const result = await prisma.metaOAuthState.updateMany({
    where: { state, used: false },
    data: { used: true },
  });
  if (result.count === 0) throw new MetaOAuthError('This login attempt was already used', 409);
};

export const exchangeAuthorizationCode = async (code: string): Promise<ExchangedToken> => {
  if (!config.meta.embeddedSignupConfigured) {
    throw new MetaOAuthError('Meta Embedded Signup is not configured on this server', 503);
  }
  if (!code || typeof code !== 'string') throw new MetaOAuthError('Missing authorization code', 400);
  try {
    return await exchangeCodeForToken(code, config.meta.appId, config.meta.appSecret);
  } catch (err: any) {
    throw new MetaOAuthError(err?.message || 'Failed to exchange authorization code', err?.status || 502);
  }
};

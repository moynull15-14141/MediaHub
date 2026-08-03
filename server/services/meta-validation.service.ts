import { prisma } from '../lib/prisma';
import { config } from '../lib/config';
import { decryptToken } from '../lib/whatsapp-crypto';
import { debugToken, fetchPhoneNumberDetails, WhatsappGraphError } from '../lib/whatsapp-graph';
import { toPublicAccount, WhatsappAccountError } from './whatsapp-account.service';
import { logAudit } from './whatsapp-audit.service';
import { getWorkspaceOwnerEmails } from './workspace.service';
import { sendMail } from '../lib/email';
import { tokenLogger } from '../lib/logger';

// Kept for backward compatibility - every pre-B.3 caller (health scheduler,
// meta-connect.controller's response shape, frontend "validation.health"
// display) still reads this coarser 4-state value. Phase B.3 layers a more
// granular WhatsappTokenStatus (Prisma enum, see schema) on top; this type
// is now DERIVED from that, not computed independently.
export type ConnectionHealth = 'CONNECTED' | 'DISCONNECTED' | 'EXPIRED' | 'PERMISSION_ERROR';

export type TokenStatus = 'CONNECTED' | 'EXPIRING' | 'EXPIRED' | 'INVALID' | 'RECONNECT_REQUIRED' | 'PERMISSION_REVOKED' | 'DISCONNECTED';

// Meta's long-lived WhatsApp Cloud API tokens have no programmatic refresh
// endpoint (no refresh_token grant anywhere in whatsapp-graph.ts) - this is
// the "notify owner before expiration / detect expiration, mark reconnect
// required" fallback the brief asks for when refresh genuinely isn't
// supported, not a placeholder for one.
const EXPIRING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const REQUIRED_SCOPES = ['whatsapp_business_management', 'whatsapp_business_messaging'];

// Meta's rate-limit error codes (app-level 4, user-level 17, page-level 32).
// A rate limit is a transient API condition, not a health signal - it must
// never be allowed to look like the token itself broke.
const RATE_LIMIT_CODES = new Set([4, 17, 32]);

type Classification =
  | { kind: 'CONNECTED' }
  | { kind: 'EXPIRING'; expiresAt: Date }
  | { kind: 'EXPIRED'; expiresAt: Date }
  | { kind: 'INVALID'; message: string }
  | { kind: 'PERMISSION_REVOKED'; message: string }
  | { kind: 'DISCONNECTED'; message: string }
  | { kind: 'RATE_LIMITED' };

// Pure-ish classifier: makes the actual Graph calls, but all *decision*
// logic (which of the 7 states this run represents) lives here so the
// transition/persistence logic below stays simple and testable in isolation.
const classifyToken = async (
  phoneNumberId: string,
  accessToken: string,
): Promise<Classification> => {
  try {
    let scopes: string[] = [];
    let tokenIsValid: boolean | null = null;
    let tokenExpiresAt: Date | null = null;

    if (config.meta.appId && config.meta.appSecret) {
      const info = await debugToken(accessToken, config.meta.appId, config.meta.appSecret).catch((err) => {
        if (err instanceof WhatsappGraphError && err.metaErrorCode && RATE_LIMIT_CODES.has(err.metaErrorCode)) throw err;
        return null;
      });
      if (info) {
        tokenIsValid = info.isValid;
        tokenExpiresAt = info.expiresAt;
        scopes = info.scopes;
      }
    }

    if (tokenIsValid === false) {
      return { kind: 'INVALID', message: 'Access token is no longer valid - reconnect this account' };
    }
    if (tokenExpiresAt && tokenExpiresAt.getTime() < Date.now()) {
      return { kind: 'EXPIRED', expiresAt: tokenExpiresAt };
    }

    // Either debug_token said the token is valid, or app credentials aren't
    // configured to ask it - either way, confirm the token can actually
    // still call the Cloud API for this phone number.
    await fetchPhoneNumberDetails(phoneNumberId, accessToken);

    const missingScopes = scopes.length > 0 ? REQUIRED_SCOPES.filter((s) => !scopes.includes(s)) : [];
    if (missingScopes.length > 0) {
      return { kind: 'PERMISSION_REVOKED', message: `Missing required permission(s): ${missingScopes.join(', ')}` };
    }
    if (tokenExpiresAt && tokenExpiresAt.getTime() - Date.now() < EXPIRING_WINDOW_MS) {
      return { kind: 'EXPIRING', expiresAt: tokenExpiresAt };
    }
    return { kind: 'CONNECTED' };
  } catch (err) {
    if (err instanceof WhatsappGraphError && err.metaErrorCode && RATE_LIMIT_CODES.has(err.metaErrorCode)) {
      return { kind: 'RATE_LIMITED' };
    }
    if (err instanceof WhatsappGraphError && (err.status === 401 || err.status === 403)) {
      return { kind: 'PERMISSION_REVOKED', message: err.message };
    }
    if (err instanceof WhatsappGraphError) {
      return { kind: 'DISCONNECTED', message: err.message };
    }
    return { kind: 'DISCONNECTED', message: 'Validation failed unexpectedly' };
  }
};

// The state machine (brief's exact diagram): EXPIRED is a logged instant,
// not a resting state - Meta has no refresh path, so an expired token goes
// straight to RECONNECT_REQUIRED, the actionable state. INVALID and
// PERMISSION_REVOKED persist as themselves until a later validation
// classifies CONNECTED again (token replaced, permissions restored, or a
// fresh reconnect). RECONNECT_REQUIRED only clears via an explicit reconnect
// (meta-signup.service.ts / whatsapp-account.service.ts resetting it), not
// by validateAccount classifying CONNECTED on its own - a stale token
// doesn't un-expire itself.
const resolveNextStatus = (previous: TokenStatus, classification: Classification): { next: TokenStatus; message: string } => {
  switch (classification.kind) {
    case 'CONNECTED':
      return { next: 'CONNECTED', message: 'Account is connected and healthy' };
    case 'EXPIRING':
      return { next: 'EXPIRING', message: `Access token expires on ${classification.expiresAt.toISOString()}` };
    case 'EXPIRED':
      return { next: 'RECONNECT_REQUIRED', message: `Access token expired on ${classification.expiresAt.toISOString()} - reconnect required` };
    case 'INVALID':
      return { next: 'INVALID', message: classification.message };
    case 'PERMISSION_REVOKED':
      return { next: 'PERMISSION_REVOKED', message: classification.message };
    case 'DISCONNECTED':
      return { next: previous === 'RECONNECT_REQUIRED' ? 'RECONNECT_REQUIRED' : 'DISCONNECTED', message: classification.message };
    default:
      return { next: previous, message: 'Unable to validate this account' };
  }
};

const TOKEN_STATUS_TO_HEALTH: Record<TokenStatus, ConnectionHealth> = {
  CONNECTED: 'CONNECTED',
  EXPIRING: 'CONNECTED',
  EXPIRED: 'EXPIRED',
  RECONNECT_REQUIRED: 'EXPIRED',
  INVALID: 'DISCONNECTED',
  PERMISSION_REVOKED: 'PERMISSION_ERROR',
  DISCONNECTED: 'DISCONNECTED',
};

const AUTO_PAUSE_STATES: ReadonlySet<TokenStatus> = new Set(['RECONNECT_REQUIRED', 'INVALID', 'PERMISSION_REVOKED']);
export const requiresAutoPause = (status: TokenStatus): boolean => AUTO_PAUSE_STATES.has(status);

const TOKEN_EVENT_NAME: Record<TokenStatus, string> = {
  CONNECTED: 'TOKEN_VALIDATED',
  EXPIRING: 'TOKEN_VALIDATED',
  EXPIRED: 'TOKEN_EXPIRED',
  RECONNECT_REQUIRED: 'TOKEN_RECONNECT_REQUIRED',
  INVALID: 'TOKEN_INVALID',
  PERMISSION_REVOKED: 'TOKEN_PERMISSION_REVOKED',
  DISCONNECTED: 'TOKEN_VALIDATED',
};

// Notification stage for the 7d/3d/24h/expired warning system - `null` means
// "nothing to warn about right now." Computed from the persisted next state
// + expiry proximity so `validateAccount` can dedupe against the account's
// stored `notificationType` and fire at most once per stage.
const resolveNotificationStage = (next: TokenStatus, expiresAt: Date | null): string | null => {
  if (next === 'RECONNECT_REQUIRED') return 'RECONNECT_REQUIRED';
  if (next === 'PERMISSION_REVOKED') return 'PERMISSION_REVOKED';
  if (next === 'INVALID') return 'INVALID';
  if (next === 'EXPIRING' && expiresAt) {
    const msLeft = expiresAt.getTime() - Date.now();
    if (msLeft <= 24 * 60 * 60 * 1000) return 'EXPIRING_24H';
    if (msLeft <= 3 * 24 * 60 * 60 * 1000) return 'EXPIRING_3D';
    return 'EXPIRING_7D';
  }
  return null;
};

// Part 9: Validate Token / Phone Number ID / Business Account / Permissions
// / Status. Extended in Phase B.3 with a real state machine (tokenStatus),
// structured logging, latency tracking, and staged expiry warnings - the
// on-demand POST /account/meta/validate route and the 30-min health
// scheduler both still call this one function, unchanged signature.
export const validateAccount = async (workspaceId: string, userId: string) => {
  const account = await prisma.whatsappAccount.findUnique({ where: { userId } });
  if (!account) throw new WhatsappAccountError('No WhatsApp account is connected', 404);
  if (account.workspaceId !== workspaceId) throw new WhatsappAccountError('This account does not belong to your workspace', 403);

  const previousStatus = account.tokenStatus as TokenStatus;
  const startedAt = Date.now();
  // A malformed/corrupted stored ciphertext (e.g. legacy row, storage
  // corruption) must classify as INVALID like any other bad token, not crash
  // the request - decryptToken throws synchronously, so it has to be inside
  // the same failure path as the network classification below.
  let classification: Classification;
  try {
    const accessToken = decryptToken(account.accessTokenEncrypted);
    classification = await classifyToken(account.phoneNumberId, accessToken);
  } catch (err) {
    classification = { kind: 'INVALID', message: err instanceof Error ? err.message : 'Stored access token could not be read' };
  }
  const validationLatency = Date.now() - startedAt;
  const now = new Date();

  if (classification.kind === 'RATE_LIMITED') {
    tokenLogger.warn('TOKEN_VALIDATION_RATE_LIMITED', { accountId: account.id, workspaceId, latencyMs: validationLatency });
    await prisma.whatsappAccount.update({
      where: { userId },
      data: { lastTokenValidation: now, validationLatency },
    });
    await logAudit(userId, 'TOKEN_VALIDATION_RATE_LIMITED', `latency=${validationLatency}ms`);
    return {
      ...toPublicAccount({ ...account, lastTokenValidation: now, validationLatency }),
      validation: { health: TOKEN_STATUS_TO_HEALTH[previousStatus], tokenStatus: previousStatus, message: 'Meta rate-limited this validation request - retrying next cycle', checkedAt: now },
    };
  }

  const { next: nextStatus, message: statusMessage } = resolveNextStatus(previousStatus, classification);
  const expiresAt = classification.kind === 'EXPIRING' || classification.kind === 'EXPIRED' ? classification.expiresAt : null;
  const transitioned = previousStatus !== nextStatus;

  const health = TOKEN_STATUS_TO_HEALTH[nextStatus];
  const data: Record<string, unknown> = {
    tokenStatus: nextStatus,
    connectionHealth: health,
    status: health === 'CONNECTED' ? 'CONNECTED' : health === 'DISCONNECTED' ? 'DISCONNECTED' : 'ERROR',
    lastValidationAt: now,
    lastValidationStatus: statusMessage,
    lastErrorMessage: nextStatus === 'CONNECTED' ? null : statusMessage,
    lastHealthCheck: now,
    lastTokenValidation: now,
    validationLatency,
    tokenExpiringSoon: nextStatus === 'EXPIRING',
    consecutiveValidationFailures: nextStatus === 'CONNECTED' ? 0 : account.consecutiveValidationFailures + 1,
  };
  if (nextStatus === 'CONNECTED') {
    data.lastSuccessfulValidation = now;
  } else {
    data.lastFailedValidation = now;
    data.validationFailureReason = statusMessage;
  }
  if (transitioned) {
    data.connectionStateUpdatedAt = now;
    data.tokenStateVersion = { increment: 1 };
    if (nextStatus === 'RECONNECT_REQUIRED') data.lastReconnectRequiredAt = now;
  }

  const updated = await prisma.whatsappAccount.update({ where: { userId }, data: data as any });

  if (transitioned) {
    const eventName = TOKEN_EVENT_NAME[nextStatus];
    tokenLogger.info(eventName, { accountId: account.id, workspaceId, previousStatus, nextStatus, latencyMs: validationLatency, reason: statusMessage });
    await logAudit(userId, eventName, `${previousStatus} -> ${nextStatus}: ${statusMessage}`);
  } else {
    tokenLogger.debug('TOKEN_VALIDATED', { accountId: account.id, workspaceId, tokenStatus: nextStatus, latencyMs: validationLatency });
  }
  await logAudit(userId, 'ACCOUNT_VALIDATED', `${health}: ${statusMessage}`);

  // Staged warning system - at most one notification per stage, per the
  // brief's explicit "do not spam" requirement. Dedup against the account's
  // own stored notificationType; reaching CONNECTED clears it so a future
  // expiry cycle can warn fresh.
  const stage = resolveNotificationStage(nextStatus, expiresAt);
  if (stage && stage !== account.notificationType) {
    await logAudit(userId, 'TOKEN_LIFECYCLE_NOTIFICATION', `stage=${stage}`);
    if (account.notifyEmail) {
      const owners = await getWorkspaceOwnerEmails(workspaceId);
      if (owners.length > 0) {
        const label = account.businessName || account.displayPhoneNumber || account.phoneNumberId;
        await sendMail({
          to: owners,
          subject: `WhatsApp account needs attention - ${label} (${stage})`,
          text: [
            `Business: ${label}`,
            `Phone: ${account.displayPhoneNumber || account.phoneNumberId}`,
            `Reason: ${statusMessage}`,
            `Reconnect: ${config.meta.embeddedSignupConfigured ? 'Open the Accounts page and click Reconnect' : 'Rotate the access token from the Accounts page'}`,
            `Time detected: ${now.toISOString()}`,
          ].join('\n'),
        });
      }
    }
    await prisma.whatsappAccount.update({ where: { userId }, data: { notificationType: stage, notificationSentAt: now } });
  } else if (nextStatus === 'CONNECTED' && account.notificationType) {
    await prisma.whatsappAccount.update({ where: { userId }, data: { notificationType: null } });
  }

  return { ...toPublicAccount(updated), validation: { health, tokenStatus: nextStatus, message: statusMessage, checkedAt: now } };
};

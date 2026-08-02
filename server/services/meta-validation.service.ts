import { prisma } from '../lib/prisma';
import { config } from '../lib/config';
import { decryptToken } from '../lib/whatsapp-crypto';
import { debugToken, fetchPhoneNumberDetails, WhatsappGraphError } from '../lib/whatsapp-graph';
import { toPublicAccount, WhatsappAccountError } from './whatsapp-account.service';
import { logAudit } from './whatsapp-audit.service';

export type ConnectionHealth = 'CONNECTED' | 'DISCONNECTED' | 'EXPIRED' | 'PERMISSION_ERROR';

// Part 9: Validate Token / Phone Number ID / Business Account / Permissions
// / Status, and classify into exactly the 4 states the brief asks the UI to
// show. Uses Meta's own /debug_token introspection (is_valid, expires_at,
// scopes) as the primary signal, falling back to a live phone-number call so
// a token that /debug_token can't classify still gets exercised for real.
export const validateAccount = async (workspaceId: string, userId: string) => {
  const account = await prisma.whatsappAccount.findUnique({ where: { userId } });
  if (!account) throw new WhatsappAccountError('No WhatsApp account is connected', 404);
  if (account.workspaceId !== workspaceId) throw new WhatsappAccountError('This account does not belong to your workspace', 403);

  let health: ConnectionHealth = 'DISCONNECTED';
  let statusMessage = 'Unable to validate this account';

  try {
    const accessToken = decryptToken(account.accessTokenEncrypted);

    const requiredScopes = ['whatsapp_business_management', 'whatsapp_business_messaging'];
    let scopes: string[] = [];
    let tokenIsValid: boolean | null = null;
    let tokenExpiresAt: Date | null = null;

    if (config.meta.appId && config.meta.appSecret) {
      const info = await debugToken(accessToken, config.meta.appId, config.meta.appSecret).catch(() => null);
      if (info) {
        tokenIsValid = info.isValid;
        tokenExpiresAt = info.expiresAt;
        scopes = info.scopes;
      }
    }

    if (tokenIsValid === false) {
      health = 'EXPIRED';
      statusMessage = 'Access token is no longer valid - reconnect this account';
    } else if (tokenExpiresAt && tokenExpiresAt.getTime() < Date.now()) {
      health = 'EXPIRED';
      statusMessage = `Access token expired on ${tokenExpiresAt.toISOString()}`;
    } else {
      // Either debug_token said the token is valid, or app credentials
      // aren't configured to ask it - either way, confirm the token can
      // actually still call the Cloud API for this phone number.
      await fetchPhoneNumberDetails(account.phoneNumberId, accessToken);

      const missingScopes = scopes.length > 0 ? requiredScopes.filter((s) => !scopes.includes(s)) : [];
      if (missingScopes.length > 0) {
        health = 'PERMISSION_ERROR';
        statusMessage = `Missing required permission(s): ${missingScopes.join(', ')}`;
      } else {
        health = 'CONNECTED';
        statusMessage = 'Account is connected and healthy';
      }
    }
  } catch (err) {
    if (err instanceof WhatsappGraphError && (err.status === 401 || err.status === 403)) {
      health = 'PERMISSION_ERROR';
      statusMessage = err.message;
    } else if (err instanceof WhatsappGraphError) {
      health = 'DISCONNECTED';
      statusMessage = err.message;
    } else {
      health = 'DISCONNECTED';
      statusMessage = 'Validation failed unexpectedly';
    }
  }

  const now = new Date();
  const updated = await prisma.whatsappAccount.update({
    where: { userId },
    data: {
      connectionHealth: health,
      status: health === 'CONNECTED' ? 'CONNECTED' : health === 'DISCONNECTED' ? 'DISCONNECTED' : 'ERROR',
      lastValidationAt: now,
      lastValidationStatus: statusMessage,
      lastErrorMessage: health === 'CONNECTED' ? null : statusMessage,
    },
  });

  await logAudit(userId, 'ACCOUNT_VALIDATED', `${health}: ${statusMessage}`);
  return { ...toPublicAccount(updated), validation: { health, message: statusMessage, checkedAt: now } };
};

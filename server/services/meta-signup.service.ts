import { prisma } from '../lib/prisma';
import { encryptToken } from '../lib/whatsapp-crypto';
import { WhatsappGraphError } from '../lib/whatsapp-graph';
import { toPublicAccount, qualityToHealth } from './whatsapp-account.service';
import { consumeOAuthState, exchangeAuthorizationCode, MetaOAuthError } from './meta-oauth.service';
import { fetchLiveAccountData } from './meta-sync.service';
import { logAudit } from './whatsapp-audit.service';
import { requiresAutoPause } from './meta-validation.service';
import { resumeAutoPausedCampaignsForAccount } from './campaign-queue.service';
import { registerAccountWebhook } from './webhook-registration.service';

export class MetaSignupError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const asText = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export interface EmbeddedSignupInput {
  code: string;
  state: string;
  wabaId: string;
  phoneNumberId: string;
  businessId?: string;
}

const validateInput = (body: any): EmbeddedSignupInput => {
  const code = asText(body?.code, 4000);
  const state = asText(body?.state, 200);
  const wabaId = asText(body?.wabaId, 128);
  const phoneNumberId = asText(body?.phoneNumberId, 128);
  const businessId = asText(body?.businessId, 128) || undefined;

  if (!code) throw new MetaSignupError('Missing authorization code from Facebook', 400);
  if (!state) throw new MetaSignupError('Missing state parameter', 400);
  if (!wabaId) throw new MetaSignupError('Missing WhatsApp Business Account ID from Embedded Signup', 400);
  if (!phoneNumberId) throw new MetaSignupError('Missing Phone Number ID from Embedded Signup', 400);
  return { code, state, wabaId, phoneNumberId, businessId };
};

// Part 3+4+5+6: the single orchestration entry point for the whole Embedded
// Signup completion. Validates the callback (state/workspace/user), never
// lets a raw token reach the response, and immediately syncs the business
// profile it just connected - all inside one transaction-adjacent flow so a
// partial failure (e.g. WABA lookup fails) still surfaces a clear error
// instead of silently leaving a half-connected row.
export const completeEmbeddedSignup = async (workspaceId: string, userId: string, body: any) => {
  const input = validateInput(body);

  try {
    await consumeOAuthState(input.state, workspaceId, userId);
  } catch (err) {
    if (err instanceof MetaOAuthError) throw new MetaSignupError(err.message, err.status);
    throw err;
  }

  let accessToken: string;
  let expiresInSeconds: number | null;
  try {
    const exchanged = await exchangeAuthorizationCode(input.code);
    accessToken = exchanged.accessToken;
    expiresInSeconds = exchanged.expiresInSeconds;
  } catch (err) {
    if (err instanceof MetaOAuthError) throw new MetaSignupError(err.message, err.status);
    throw err;
  }

  // Phase B.3 - captured before the upsert below so we know whether this
  // completion is a genuine reconnect-from-trouble (to decide whether to
  // auto-resume paused campaigns) vs a brand-new connection (nothing to
  // resume). Reused Phase B.2 finding still holds: `userId` is @unique, so
  // this upsert can never create a duplicate row for "same WABA/phone/
  // business" - it always updates the existing one, preserving campaigns/
  // analytics/history/queue untouched.
  const existing = await prisma.whatsappAccount.findUnique({ where: { userId }, select: { id: true, tokenStatus: true } });

  try {
    const { phoneDetails, wabaDetails, businessDetails, tokenInfo } = await fetchLiveAccountData(
      input.phoneNumberId,
      input.wabaId,
      input.businessId || null,
      accessToken,
    );

    const now = new Date();
    const tokenExpiresAt = tokenInfo?.expiresAt ?? (expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000) : null);

    const data = {
      workspaceId,
      phoneNumberId: input.phoneNumberId,
      wabaId: input.wabaId,
      displayPhoneNumber: phoneDetails.displayPhoneNumber,
      businessName: businessDetails?.name || wabaDetails?.name || phoneDetails.verifiedName,
      verifiedName: phoneDetails.verifiedName,
      qualityRating: phoneDetails.qualityRating,
      messagingLimitTier: phoneDetails.messagingLimitTier,
      healthStatus: qualityToHealth(phoneDetails.qualityRating),
      status: 'CONNECTED' as const,
      connectionSource: 'META_EMBEDDED_SIGNUP' as const,
      connectionHealth: 'CONNECTED' as const,
      metaBusinessId: input.businessId || null,
      metaBusinessName: businessDetails?.name || null,
      businessVerificationStatus: businessDetails?.verificationStatus || null,
      accountReviewStatus: wabaDetails?.accountReviewStatus ?? null,
      grantedScopes: tokenInfo?.scopes?.length ? tokenInfo.scopes.join(',') : null,
      accessTokenEncrypted: encryptToken(accessToken),
      tokenCreatedAt: now,
      tokenUpdatedAt: now,
      lastTokenRefresh: now,
      tokenExpiresAt,
      lastErrorMessage: null,
      lastSyncAt: now,
      lastValidationAt: now,
      lastValidationStatus: 'VALID',
      // Phase B.3 - a completed Embedded Signup is always a reconnect event.
      tokenStatus: 'CONNECTED' as const,
      consecutiveValidationFailures: 0,
      notificationType: null,
      lastReconnectAt: now,
      reconnectReason: null,
    };

    const account = await prisma.whatsappAccount.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });

    await logAudit(userId, 'ACCOUNT_CONNECTED_META_EMBEDDED_SIGNUP', `WABA ${input.wabaId}, phone ${input.phoneNumberId}`);

    // Phase B.3 - auto-resume campaigns that were auto-paused because the
    // OLD token broke, now that reconnect just replaced it. Only fires when
    // the account was actually in a trouble state before this call -  a
    // first-time connect or a reconnect while already healthy has nothing
    // to resume.
    if (existing && requiresAutoPause(existing.tokenStatus as any)) {
      const resumedCount = await resumeAutoPausedCampaignsForAccount(existing.id);
      await logAudit(userId, 'TOKEN_RECONNECTED', `via embedded signup, was ${existing.tokenStatus}, resumed ${resumedCount} campaign(s)`);
    }

    // Phase B.4 - webhook auto-registration (3 attempts, exponential backoff,
    // never blocks or fails the signup itself). Failure - including
    // exhausting the retry ladder - is recorded on the account row and
    // picked up later by the background sweep (webhook-registration.service's
    // retryPendingWebhookSubscriptions), not retried further here.
    const result = await registerAccountWebhook(account.id, input.wabaId, accessToken, userId);
    if (result.subscribed) {
      const withWebhook = await prisma.whatsappAccount.findUniqueOrThrow({ where: { id: account.id } });
      return toPublicAccount(withWebhook);
    }

    return toPublicAccount(account);
  } catch (err) {
    if (err instanceof WhatsappGraphError) {
      await logAudit(userId, 'ACCOUNT_CONNECT_FAILED', err.message);
      throw new MetaSignupError(err.message, err.status);
    }
    throw err;
  }
};

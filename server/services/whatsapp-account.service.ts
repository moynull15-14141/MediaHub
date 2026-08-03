import { prisma } from '../lib/prisma';
import { encryptToken, decryptToken } from '../lib/whatsapp-crypto';
import { fetchPhoneNumberDetails, WhatsappGraphError } from '../lib/whatsapp-graph';
import { uploadBufferToR2, deleteFromR2, getPresignedViewUrl } from '../lib/r2';
import { tokenLifetimeSeconds } from './user.service';
import { logAudit } from './whatsapp-audit.service';
import { sanitizeText } from './contact.service';
import { inferAttachmentType, getMaxBytesForType } from './campaign-attachment.service';
import { pauseCampaignsForAccountFailover, resumeAutoPausedCampaignsForAccount } from './campaign-queue.service';
import { requiresAutoPause } from './meta-validation.service';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ALLOWED_LOGO_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);

export class WhatsappAccountError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const MAX_TEXT_LENGTH = 128;

export const qualityToHealth = (qualityRating: string | null): 'HEALTHY' | 'WARNING' | 'UNHEALTHY' | 'UNKNOWN' => {
  switch ((qualityRating || '').toUpperCase()) {
    case 'GREEN':
      return 'HEALTHY';
    case 'YELLOW':
      return 'WARNING';
    case 'RED':
      return 'UNHEALTHY';
    default:
      return 'UNKNOWN';
  }
};

export const toPublicAccount = (account: any) => ({
  id: account.id,
  phoneNumberId: account.phoneNumberId,
  wabaId: account.wabaId,
  displayPhoneNumber: account.displayPhoneNumber,
  businessName: account.businessName,
  qualityRating: account.qualityRating,
  healthStatus: account.healthStatus,
  status: account.status,
  lastErrorMessage: account.lastErrorMessage,
  lastSyncAt: account.lastSyncAt,
  defaultCountryCode: account.defaultCountryCode,
  autoSkipDuplicates: account.autoSkipDuplicates,
  rateLimitPerMinute: account.rateLimitPerMinute,
  minDelaySeconds: account.minDelaySeconds,
  maxDelaySeconds: account.maxDelaySeconds,
  maxRetries: account.maxRetries,
  maxConcurrentJobs: account.maxConcurrentJobs,
  sendTimezone: account.sendTimezone,
  batchSize: account.batchSize,
  retryDelaySeconds: account.retryDelaySeconds,
  businessManagerId: account.businessManagerId,
  messagingLimitTier: account.messagingLimitTier,
  webhookVerified: account.webhookVerified,
  workingHoursEnabled: account.workingHoursEnabled,
  workingHours: account.workingHours,
  defaultTemplateId: account.defaultTemplateId,
  defaultFooter: account.defaultFooter,
  defaultAttachmentKey: account.defaultAttachmentKey,
  defaultAttachmentType: account.defaultAttachmentType,
  defaultAttachmentFilename: account.defaultAttachmentFilename,
  companyName: account.companyName,
  logoKey: account.logoKey,
  language: account.language,
  notifyBrowser: account.notifyBrowser,
  notifyEmail: account.notifyEmail,
  notifyCampaignCompleted: account.notifyCampaignCompleted,
  notifyCampaignFailed: account.notifyCampaignFailed,
  notifyWebhookOffline: account.notifyWebhookOffline,
  notifyQualityDrop: account.notifyQualityDrop,
  notifyApiFailure: account.notifyApiFailure,
  // Phase B.1 - Meta Embedded Signup fields, additive to the existing shape
  // above (every pre-existing consumer of toPublicAccount ignores keys it
  // doesn't recognize, so this cannot break AccountSettingsTab.tsx or any
  // other caller built before this phase).
  connectionSource: account.connectionSource,
  connectionHealth: account.connectionHealth,
  verifiedName: account.verifiedName,
  metaBusinessId: account.metaBusinessId,
  metaBusinessName: account.metaBusinessName,
  businessVerificationStatus: account.businessVerificationStatus,
  accountReviewStatus: account.accountReviewStatus,
  grantedScopes: account.grantedScopes,
  tokenExpiresAt: account.tokenExpiresAt,
  lastValidationAt: account.lastValidationAt,
  lastValidationStatus: account.lastValidationStatus,
  // Phase B.2 - Production Multi-Account Engine, additive for the same
  // reason as the Phase B.1 block above.
  isDefault: account.isDefault,
  priority: account.priority,
  messagingLimit: account.messagingLimit,
  sendingEnabled: account.sendingEnabled,
  dailyLimit: account.dailyLimit,
  currentDailySent: account.currentDailySent,
  lastDailyReset: account.lastDailyReset,
  lastHealthCheck: account.lastHealthCheck,
  lastWebhookSync: account.lastWebhookSync,
  webhookSubscribed: account.webhookSubscribed,
  lastTokenRefresh: account.lastTokenRefresh,
  tokenExpiringSoon: account.tokenExpiringSoon,
  // Phase B.3 - Token Lifecycle Automation, additive for the same reason as
  // the Phase B.1/B.2 blocks above.
  tokenStatus: account.tokenStatus,
  lastTokenValidation: account.lastTokenValidation,
  lastSuccessfulValidation: account.lastSuccessfulValidation,
  lastFailedValidation: account.lastFailedValidation,
  lastReconnectRequiredAt: account.lastReconnectRequiredAt,
  lastReconnectAt: account.lastReconnectAt,
  reconnectReason: account.reconnectReason,
  validationFailureReason: account.validationFailureReason,
  consecutiveValidationFailures: account.consecutiveValidationFailures,
  connectionStateUpdatedAt: account.connectionStateUpdatedAt,
  validationLatency: account.validationLatency,
  createdAt: account.createdAt,
  updatedAt: account.updatedAt,
});

export interface ConnectAccountInput {
  phoneNumberId: string;
  wabaId?: string;
  accessToken: string;
}

const validateConnectInput = (body: any): ConnectAccountInput => {
  const phoneNumberId = typeof body?.phoneNumberId === 'string' ? body.phoneNumberId.trim() : '';
  const accessToken = typeof body?.accessToken === 'string' ? body.accessToken.trim() : '';
  const wabaId = typeof body?.wabaId === 'string' ? body.wabaId.trim() : undefined;

  if (!phoneNumberId || phoneNumberId.length > MAX_TEXT_LENGTH) {
    throw new WhatsappAccountError('A valid Phone Number ID is required', 400);
  }
  if (!accessToken || accessToken.length > 2000) {
    throw new WhatsappAccountError('A valid access token is required', 400);
  }
  if (wabaId !== undefined && wabaId.length > MAX_TEXT_LENGTH) {
    throw new WhatsappAccountError('WABA ID is too long', 400);
  }
  return { phoneNumberId, accessToken, wabaId: wabaId || undefined };
};

export const connectAccount = async (workspaceId: string, userId: string, body: any) => {
  const input = validateConnectInput(body);

  let details;
  try {
    details = await fetchPhoneNumberDetails(input.phoneNumberId, input.accessToken);
  } catch (err) {
    if (err instanceof WhatsappGraphError) {
      throw new WhatsappAccountError(err.message, err.status);
    }
    throw err;
  }

  const now = new Date();
  const account = await prisma.whatsappAccount.upsert({
    where: { userId },
    create: {
      userId,
      workspaceId,
      phoneNumberId: input.phoneNumberId,
      wabaId: input.wabaId,
      displayPhoneNumber: details.displayPhoneNumber,
      businessName: details.verifiedName,
      qualityRating: details.qualityRating,
      messagingLimitTier: details.messagingLimitTier,
      healthStatus: qualityToHealth(details.qualityRating),
      status: 'CONNECTED',
      accessTokenEncrypted: encryptToken(input.accessToken),
      tokenCreatedAt: now,
      tokenUpdatedAt: now,
      lastTokenRefresh: now,
      lastErrorMessage: null,
      lastSyncAt: now,
      // Phase B.3 - a fresh manual connect is a reconnect event.
      tokenStatus: 'CONNECTED',
      consecutiveValidationFailures: 0,
      notificationType: null,
      lastReconnectAt: now,
      reconnectReason: null,
    },
    update: {
      phoneNumberId: input.phoneNumberId,
      wabaId: input.wabaId,
      displayPhoneNumber: details.displayPhoneNumber,
      businessName: details.verifiedName,
      qualityRating: details.qualityRating,
      messagingLimitTier: details.messagingLimitTier,
      healthStatus: qualityToHealth(details.qualityRating),
      status: 'CONNECTED',
      accessTokenEncrypted: encryptToken(input.accessToken),
      tokenUpdatedAt: now,
      lastTokenRefresh: now,
      lastErrorMessage: null,
      lastSyncAt: now,
      // Phase B.3 - a fresh manual (re)connect resets the lifecycle state,
      // same as embedded signup's completeEmbeddedSignup does.
      tokenStatus: 'CONNECTED',
      consecutiveValidationFailures: 0,
      notificationType: null,
      lastReconnectAt: now,
      reconnectReason: null,
    },
  });

  await logAudit(userId, 'ACCOUNT_CONNECTED', `Phone number ID ${input.phoneNumberId}`);
  return toPublicAccount(account);
};

export const getAccount = async (userId: string) => {
  const account = await prisma.whatsappAccount.findUnique({ where: { userId } });
  if (!account) return null;
  const publicAccount = toPublicAccount(account);
  const logoUrl = account.logoKey ? await getPresignedViewUrl(account.logoKey).catch(() => null) : null;
  return { ...publicAccount, logoUrl };
};

export const disconnectAccount = async (userId: string) => {
  const account = await prisma.whatsappAccount.findUnique({ where: { userId } });
  if (!account) throw new WhatsappAccountError('No WhatsApp account is connected', 404);
  await prisma.whatsappAccount.delete({ where: { userId } });
  await logAudit(userId, 'ACCOUNT_DISCONNECTED');
};

export const refreshConnection = async (userId: string) => {
  const account = await prisma.whatsappAccount.findUnique({ where: { userId } });
  if (!account) throw new WhatsappAccountError('No WhatsApp account is connected', 404);

  const previousQuality = account.qualityRating;
  try {
    const accessToken = decryptToken(account.accessTokenEncrypted);
    const details = await fetchPhoneNumberDetails(account.phoneNumberId, accessToken);
    const updated = await prisma.whatsappAccount.update({
      where: { userId },
      data: {
        displayPhoneNumber: details.displayPhoneNumber,
        businessName: details.verifiedName,
        qualityRating: details.qualityRating,
        messagingLimitTier: details.messagingLimitTier,
        healthStatus: qualityToHealth(details.qualityRating),
        status: 'CONNECTED',
        lastErrorMessage: null,
        lastSyncAt: new Date(),
      },
    });
    if (previousQuality && details.qualityRating && previousQuality !== details.qualityRating && details.qualityRating.toUpperCase() !== 'GREEN') {
      await logAudit(userId, 'QUALITY_RATING_CHANGED', `${previousQuality} -> ${details.qualityRating}`);
    }
    return toPublicAccount(updated);
  } catch (err) {
    const message = err instanceof WhatsappGraphError ? err.message : 'Failed to refresh connection';
    const updated = await prisma.whatsappAccount.update({
      where: { userId },
      data: {
        status: 'ERROR',
        healthStatus: 'UNKNOWN',
        lastErrorMessage: message,
        lastSyncAt: new Date(),
      },
    });
    return toPublicAccount(updated);
  }
};

export interface AccountSettingsInput {
  defaultCountryCode?: string | null;
  autoSkipDuplicates?: boolean;
  rateLimitPerMinute?: number;
  minDelaySeconds?: number;
  maxDelaySeconds?: number;
  maxRetries?: number;
  maxConcurrentJobs?: number;
  sendTimezone?: string;
  batchSize?: number;
  retryDelaySeconds?: number;
  businessManagerId?: string | null;
  workingHoursEnabled?: boolean;
  workingHours?: any;
  defaultTemplateId?: string | null;
  defaultFooter?: string | null;
  companyName?: string | null;
  language?: string;
  notifyBrowser?: boolean;
  notifyEmail?: boolean;
  notifyCampaignCompleted?: boolean;
  notifyCampaignFailed?: boolean;
  notifyWebhookOffline?: boolean;
  notifyQualityDrop?: boolean;
  notifyApiFailure?: boolean;
}

const isValidTimezone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const validateIntSetting = (value: unknown, name: string, min: number, max: number): number => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new WhatsappAccountError(`${name} must be an integer between ${min} and ${max}`, 400);
  }
  return n;
};

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ALLOWED_LANGUAGES = ['en', 'bn', 'es', 'fr', 'ar', 'hi', 'pt', 'id'];

const validateWorkingHours = (value: unknown): Record<string, { enabled: boolean; start: string; end: string }> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WhatsappAccountError('workingHours must be an object keyed by weekday', 400);
  }
  const result: Record<string, { enabled: boolean; start: string; end: string }> = {};
  for (const day of DAY_KEYS) {
    const entry = (value as any)[day];
    if (!entry) continue;
    const enabled = Boolean(entry.enabled);
    const start = typeof entry.start === 'string' ? entry.start : '09:00';
    const end = typeof entry.end === 'string' ? entry.end : '18:00';
    if (!TIME_PATTERN.test(start) || !TIME_PATTERN.test(end)) {
      throw new WhatsappAccountError(`Invalid time for ${day}: use HH:MM (24h)`, 400);
    }
    result[day] = { enabled, start, end };
  }
  return result;
};

export const updateAccountSettings = async (userId: string, body: any) => {
  const account = await prisma.whatsappAccount.findUnique({ where: { userId } });
  if (!account) throw new WhatsappAccountError('No WhatsApp account is connected', 404);

  const data: AccountSettingsInput = {};
  if (body?.defaultCountryCode !== undefined) {
    const code = typeof body.defaultCountryCode === 'string' ? body.defaultCountryCode.trim() : '';
    if (code && !/^\+?[0-9]{1,4}$/.test(code)) {
      throw new WhatsappAccountError('Invalid default country code', 400);
    }
    data.defaultCountryCode = code || null;
  }
  if (body?.autoSkipDuplicates !== undefined) {
    data.autoSkipDuplicates = Boolean(body.autoSkipDuplicates);
  }
  if (body?.rateLimitPerMinute !== undefined) {
    data.rateLimitPerMinute = validateIntSetting(body.rateLimitPerMinute, 'rateLimitPerMinute', 1, 1000);
  }
  if (body?.minDelaySeconds !== undefined) {
    data.minDelaySeconds = validateIntSetting(body.minDelaySeconds, 'minDelaySeconds', 0, 3600);
  }
  if (body?.maxDelaySeconds !== undefined) {
    data.maxDelaySeconds = validateIntSetting(body.maxDelaySeconds, 'maxDelaySeconds', 0, 3600);
  }
  if (data.minDelaySeconds !== undefined && data.maxDelaySeconds !== undefined && data.minDelaySeconds > data.maxDelaySeconds) {
    throw new WhatsappAccountError('minDelaySeconds cannot be greater than maxDelaySeconds', 400);
  }
  if (body?.maxRetries !== undefined) {
    data.maxRetries = validateIntSetting(body.maxRetries, 'maxRetries', 0, 10);
  }
  if (body?.maxConcurrentJobs !== undefined) {
    data.maxConcurrentJobs = validateIntSetting(body.maxConcurrentJobs, 'maxConcurrentJobs', 1, 50);
  }
  if (body?.batchSize !== undefined) {
    data.batchSize = validateIntSetting(body.batchSize, 'batchSize', 10, 5000);
  }
  if (body?.retryDelaySeconds !== undefined) {
    data.retryDelaySeconds = validateIntSetting(body.retryDelaySeconds, 'retryDelaySeconds', 1, 3600);
  }
  if (body?.sendTimezone !== undefined) {
    const tz = typeof body.sendTimezone === 'string' ? body.sendTimezone.trim() : '';
    if (!tz || !isValidTimezone(tz)) {
      throw new WhatsappAccountError(`Invalid timezone: ${body.sendTimezone}`, 400);
    }
    data.sendTimezone = tz;
  }
  if (body?.businessManagerId !== undefined) {
    data.businessManagerId = sanitizeText(body.businessManagerId, MAX_TEXT_LENGTH) || null;
  }
  if (body?.workingHoursEnabled !== undefined) {
    data.workingHoursEnabled = Boolean(body.workingHoursEnabled);
  }
  if (body?.workingHours !== undefined) {
    data.workingHours = validateWorkingHours(body.workingHours);
  }
  if (body?.defaultTemplateId !== undefined) {
    if (body.defaultTemplateId) {
      const template = await prisma.messageTemplate.findUnique({ where: { id: body.defaultTemplateId } });
      if (!template || template.userId !== userId) {
        throw new WhatsappAccountError('Default template not found', 400);
      }
    }
    data.defaultTemplateId = body.defaultTemplateId || null;
  }
  if (body?.defaultFooter !== undefined) {
    data.defaultFooter = sanitizeText(body.defaultFooter, 500) || null;
  }
  if (body?.companyName !== undefined) {
    data.companyName = sanitizeText(body.companyName, 150) || null;
  }
  if (body?.language !== undefined) {
    if (!ALLOWED_LANGUAGES.includes(body.language)) {
      throw new WhatsappAccountError(`Invalid language: ${body.language}`, 400);
    }
    data.language = body.language;
  }
  for (const field of [
    'notifyBrowser', 'notifyEmail', 'notifyCampaignCompleted', 'notifyCampaignFailed',
    'notifyWebhookOffline', 'notifyQualityDrop', 'notifyApiFailure',
  ] as const) {
    if (body?.[field] !== undefined) {
      (data as any)[field] = Boolean(body[field]);
    }
  }

  const updated = await prisma.whatsappAccount.update({ where: { userId }, data });
  await logAudit(userId, 'SETTINGS_UPDATED', Object.keys(data).join(', '));
  return toPublicAccount(updated);
};

export const rotateToken = async (userId: string, body: any) => {
  const existing = await prisma.whatsappAccount.findUnique({ where: { userId } });
  if (!existing) throw new WhatsappAccountError('No WhatsApp account is connected', 404);

  const accessToken = typeof body?.accessToken === 'string' ? body.accessToken.trim() : '';
  if (!accessToken || accessToken.length > 2000) {
    throw new WhatsappAccountError('A valid access token is required', 400);
  }

  let details;
  try {
    details = await fetchPhoneNumberDetails(existing.phoneNumberId, accessToken);
  } catch (err) {
    if (err instanceof WhatsappGraphError) throw new WhatsappAccountError(err.message, err.status);
    throw err;
  }

  const now = new Date();
  const updated = await prisma.whatsappAccount.update({
    where: { userId },
    data: {
      accessTokenEncrypted: encryptToken(accessToken),
      tokenUpdatedAt: now,
      lastTokenRefresh: now,
      displayPhoneNumber: details.displayPhoneNumber,
      businessName: details.verifiedName,
      qualityRating: details.qualityRating,
      messagingLimitTier: details.messagingLimitTier,
      healthStatus: qualityToHealth(details.qualityRating),
      status: 'CONNECTED',
      lastErrorMessage: null,
      lastSyncAt: now,
      // Phase B.3 - a rotated token is a reconnect event: reset the
      // lifecycle state and auto-resume anything that was auto-paused
      // because of the old (broken) token, without waiting for the next
      // scheduler tick.
      tokenStatus: 'CONNECTED',
      consecutiveValidationFailures: 0,
      notificationType: null,
      lastReconnectAt: now,
      reconnectReason: null,
    },
  });

  if (requiresAutoPause(existing.tokenStatus as any)) {
    await resumeAutoPausedCampaignsForAccount(existing.id);
    await logAudit(userId, 'TOKEN_RECONNECTED', `via rotate-token, was ${existing.tokenStatus}`);
  }

  await logAudit(userId, 'TOKEN_ROTATED');
  return toPublicAccount(updated);
};

export const getSecurityInfo = async (userId: string) => {
  const account = await prisma.whatsappAccount.findUnique({ where: { userId } });
  return {
    hasToken: !!account?.accessTokenEncrypted,
    tokenCreatedAt: account?.tokenCreatedAt ?? null,
    tokenUpdatedAt: account?.tokenUpdatedAt ?? null,
    sessionTimeoutSeconds: tokenLifetimeSeconds,
    activeSessionsNote: 'Not tracked - sessions are stateless JWTs, not stored server-side.',
  };
};

export const getWebhookMonitor = async (userId: string) => {
  const account = await prisma.whatsappAccount.findUnique({ where: { userId } });
  if (!account) {
    return {
      connected: false,
      webhookVerified: false,
      webhookLastPingAt: null,
      webhookLastDeliveryAt: null,
      webhookLastReadAt: null,
      webhookLastErrorAt: null,
      webhookLastErrorMessage: null,
    };
  }
  return {
    connected: true,
    webhookVerified: account.webhookVerified,
    webhookLastPingAt: account.webhookLastPingAt,
    webhookLastDeliveryAt: account.webhookLastDeliveryAt,
    webhookLastReadAt: account.webhookLastReadAt,
    webhookLastErrorAt: account.webhookLastErrorAt,
    webhookLastErrorMessage: account.webhookLastErrorMessage,
  };
};

export interface LogoUploadInfo {
  buffer: Buffer;
  mimeType: string;
  sizeBytes: number;
}

export const uploadLogo = async (userId: string, info: LogoUploadInfo) => {
  const account = await prisma.whatsappAccount.findUnique({ where: { userId } });
  if (!account) throw new WhatsappAccountError('No WhatsApp account is connected', 404);
  if (!ALLOWED_LOGO_MIME.has(info.mimeType)) {
    throw new WhatsappAccountError('Unsupported logo type. Use PNG, JPEG, WEBP, or SVG.', 400);
  }
  if (info.sizeBytes > MAX_LOGO_BYTES) {
    throw new WhatsappAccountError('Logo exceeds the 2MB size limit', 413);
  }

  const ext = info.mimeType === 'image/png' ? 'png' : info.mimeType === 'image/webp' ? 'webp' : info.mimeType === 'image/svg+xml' ? 'svg' : 'jpg';
  const key = `whatsapp-brand-logos/${userId}/logo.${ext}`;
  await uploadBufferToR2(info.buffer, key, info.mimeType);

  if (account.logoKey && account.logoKey !== key) {
    await deleteFromR2([account.logoKey]);
  }

  await prisma.whatsappAccount.update({ where: { userId }, data: { logoKey: key } });
  return { logoKey: key, logoUrl: await getPresignedViewUrl(key) };
};

export const removeLogo = async (userId: string) => {
  const account = await prisma.whatsappAccount.findUnique({ where: { userId } });
  if (!account) throw new WhatsappAccountError('No WhatsApp account is connected', 404);
  if (account.logoKey) await deleteFromR2([account.logoKey]);
  await prisma.whatsappAccount.update({ where: { userId }, data: { logoKey: null } });
};

export interface DefaultAttachmentUploadInfo {
  buffer: Buffer;
  originalFilename: string;
  ext: string;
  mimeType: string;
  sizeBytes: number;
}

// Reuses the exact same type/size rules as a campaign attachment (Phase 2) -
// a default attachment must be sendable the same way a real one is.
export const uploadDefaultAttachment = async (userId: string, info: DefaultAttachmentUploadInfo) => {
  const account = await prisma.whatsappAccount.findUnique({ where: { userId } });
  if (!account) throw new WhatsappAccountError('No WhatsApp account is connected', 404);

  const type = inferAttachmentType(info.ext);
  if (!type) throw new WhatsappAccountError(`Unsupported attachment type: ${info.ext}`, 400);
  const maxBytes = getMaxBytesForType(type);
  if (info.sizeBytes > maxBytes) {
    throw new WhatsappAccountError(`File exceeds the ${Math.floor(maxBytes / (1024 * 1024))}MB limit for ${type.toLowerCase()} attachments`, 413);
  }

  const key = `whatsapp-account-defaults/${userId}/default-attachment${info.ext}`;
  await uploadBufferToR2(info.buffer, key, info.mimeType);
  if (account.defaultAttachmentKey && account.defaultAttachmentKey !== key) {
    await deleteFromR2([account.defaultAttachmentKey]);
  }

  await prisma.whatsappAccount.update({
    where: { userId },
    data: {
      defaultAttachmentKey: key,
      defaultAttachmentType: type,
      defaultAttachmentFilename: info.originalFilename.slice(0, 255),
      defaultAttachmentMimeType: info.mimeType,
    },
  });

  return { defaultAttachmentKey: key, defaultAttachmentType: type, previewUrl: await getPresignedViewUrl(key) };
};

export const removeDefaultAttachment = async (userId: string) => {
  const account = await prisma.whatsappAccount.findUnique({ where: { userId } });
  if (!account) throw new WhatsappAccountError('No WhatsApp account is connected', 404);
  if (account.defaultAttachmentKey) await deleteFromR2([account.defaultAttachmentKey]);
  await prisma.whatsappAccount.update({
    where: { userId },
    data: { defaultAttachmentKey: null, defaultAttachmentType: null, defaultAttachmentFilename: null, defaultAttachmentMimeType: null },
  });
};

// --- Phase B.2 - workspace-wide account management. Unlike every function
// above (which only ever reads/writes the CALLER's own account via
// `where: { userId }`), these three act on ANY account within the acting
// user's workspace by id - legitimate only because the routes calling them
// are gated by requireWorkspaceRole('ADMIN'), not because the underlying
// WhatsappAccount.userId-unique model changed shape. ---

const requireWorkspaceAccount = async (workspaceId: string, accountId: string) => {
  const account = await prisma.whatsappAccount.findUnique({ where: { id: accountId } });
  if (!account || account.workspaceId !== workspaceId) {
    throw new WhatsappAccountError('WhatsApp account not found in this workspace', 404);
  }
  return account;
};

export const setDefaultAccount = async (workspaceId: string, actingUserId: string, targetAccountId: string) => {
  await requireWorkspaceAccount(workspaceId, targetAccountId);
  const [, updated] = await prisma.$transaction([
    prisma.whatsappAccount.updateMany({
      where: { workspaceId, id: { not: targetAccountId } },
      data: { isDefault: false },
    }),
    prisma.whatsappAccount.update({ where: { id: targetAccountId }, data: { isDefault: true } }),
  ]);
  await logAudit(actingUserId, 'ACCOUNT_DEFAULT_CHANGED', targetAccountId);
  return toPublicAccount(updated);
};

export const setAccountPriority = async (workspaceId: string, actingUserId: string, targetAccountId: string, priority: number) => {
  await requireWorkspaceAccount(workspaceId, targetAccountId);
  if (!Number.isInteger(priority) || priority < 0 || priority > 100) {
    throw new WhatsappAccountError('priority must be an integer between 0 and 100', 400);
  }
  const updated = await prisma.whatsappAccount.update({ where: { id: targetAccountId }, data: { priority } });
  await logAudit(actingUserId, 'SETTINGS_UPDATED', `${targetAccountId}: priority -> ${priority}`);
  return toPublicAccount(updated);
};

export const setSendingEnabled = async (workspaceId: string, actingUserId: string, targetAccountId: string, enabled: boolean) => {
  const account = await requireWorkspaceAccount(workspaceId, targetAccountId);
  const updated = await prisma.whatsappAccount.update({ where: { id: targetAccountId }, data: { sendingEnabled: enabled } });

  if (account.sendingEnabled && !enabled) {
    const pausedCount = await pauseCampaignsForAccountFailover(targetAccountId, 'Sending disabled by workspace admin');
    await logAudit(actingUserId, 'ACCOUNT_SENDING_DISABLED', `${targetAccountId}: paused ${pausedCount} campaign(s)`);
  } else if (!account.sendingEnabled && enabled) {
    await logAudit(actingUserId, 'ACCOUNT_SENDING_ENABLED', targetAccountId);
  }
  return toPublicAccount(updated);
};

// --- Phase B.3 - Token Lifecycle Automation, self-service endpoints (act on
// the CALLER's own account, matching every function above except the three
// workspace-admin ones just above this block). ---

// GET /account/token-status - lightweight subset for the dashboard, so
// polling doesn't need to pull the full account payload every time.
export const getTokenStatus = async (userId: string) => {
  const account = await prisma.whatsappAccount.findUnique({ where: { userId } });
  if (!account) throw new WhatsappAccountError('No WhatsApp account is connected', 404);
  return {
    tokenStatus: account.tokenStatus,
    connectionHealth: account.connectionHealth,
    reconnectRequired: requiresAutoPause(account.tokenStatus as any),
    tokenExpiresAt: account.tokenExpiresAt,
    tokenExpiringSoon: account.tokenExpiringSoon,
    lastTokenValidation: account.lastTokenValidation,
    lastSuccessfulValidation: account.lastSuccessfulValidation,
    lastFailedValidation: account.lastFailedValidation,
    validationFailureReason: account.validationFailureReason,
    consecutiveValidationFailures: account.consecutiveValidationFailures,
    validationLatency: account.validationLatency,
    notificationType: account.notificationType,
    connectionStateUpdatedAt: account.connectionStateUpdatedAt,
    tokenStateVersion: account.tokenStateVersion,
  };
};

// POST /account/resume - manual trigger for the case where a user fixes/
// reconnects an account and doesn't want to wait up to 30 minutes for the
// next scheduler tick to auto-resume campaigns it paused.
export const resumeAccount = async (userId: string) => {
  const account = await prisma.whatsappAccount.findUnique({ where: { userId } });
  if (!account) throw new WhatsappAccountError('No WhatsApp account is connected', 404);
  const resumedCount = await resumeAutoPausedCampaignsForAccount(account.id);
  return { resumedCount };
};

import crypto from 'crypto';
import path from 'path';
import { prisma } from '../lib/prisma';
import { deleteFromR2, copyObjectInR2, getPresignedViewUrl } from '../lib/r2';
import { getCampaignAttachmentKey } from '../lib/whatsapp-campaign-paths';
import { sanitizeText } from './contact.service';
import { findUserById } from './user.service';
import { MAX_MESSAGE_LENGTH, scanVariableTokens, validateTemplate, getAvailableVariableKeysCached } from './template-engine.service';

export class CampaignError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export { MAX_MESSAGE_LENGTH };

const NAME_MAX = 150;
const DESCRIPTION_MAX = 500;
const CAMPAIGN_TYPES = ['PROMOTIONAL', 'UTILITY', 'ANNOUNCEMENT', 'OTHER'] as const;
const CAMPAIGN_STATUSES = ['DRAFT', 'READY', 'ARCHIVED'] as const;
const RECIPIENT_SOURCES = ['GROUP', 'LABEL', 'MANUAL'] as const;

const CAMPAIGN_INCLUDE = {
  recipients: { include: { contact: true } },
  attachment: true,
} as const;

const validateType = (value: unknown): (typeof CAMPAIGN_TYPES)[number] => {
  if (value === undefined || value === null || value === '') return 'OTHER';
  if (typeof value !== 'string' || !CAMPAIGN_TYPES.includes(value as any)) {
    throw new CampaignError(`Invalid campaign type: ${value}`, 400);
  }
  return value as (typeof CAMPAIGN_TYPES)[number];
};

// Draft-time save only checks message syntax - variable names are now
// open-ended per-user data (any contact field/custom field), so unknown-name
// rejection happens later, at the Ready-status gate (see updateCampaignStatus)
// where the full set of available variables can actually be checked.
export const validateMessageText = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new CampaignError('Message is required', 400);
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new CampaignError(`Message exceeds the maximum length of ${MAX_MESSAGE_LENGTH} characters`, 400);
  }
  const { malformed } = scanVariableTokens(trimmed);
  if (malformed.length > 0) {
    throw new CampaignError(`Invalid variable syntax: ${malformed[0].reason} ("${malformed[0].snippet}")`, 400);
  }
  return trimmed;
};

interface RecipientInput {
  contactId: string;
  source: (typeof RECIPIENT_SOURCES)[number];
}

const validateRecipients = async (userId: string, recipients: unknown): Promise<RecipientInput[]> => {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new CampaignError('At least one recipient is required', 400);
  }
  const deduped = new Map<string, RecipientInput>();
  for (const entry of recipients) {
    if (!entry || typeof entry.contactId !== 'string' || !RECIPIENT_SOURCES.includes(entry.source)) {
      throw new CampaignError('Invalid recipient entry', 400);
    }
    if (!deduped.has(entry.contactId)) {
      deduped.set(entry.contactId, { contactId: entry.contactId, source: entry.source });
    }
  }
  const candidates = Array.from(deduped.values());
  const owned = await prisma.contact.findMany({
    where: { id: { in: candidates.map((c) => c.contactId) }, userId },
    select: { id: true },
  });
  const ownedSet = new Set(owned.map((c) => c.id));
  const valid = candidates.filter((c) => ownedSet.has(c.contactId));
  if (valid.length === 0) {
    throw new CampaignError('None of the selected recipients are valid contacts', 400);
  }
  return valid;
};

// Records which template (if any) a campaign's message originated from, so
// Phase 6's Template Analytics can compute real usage/success/read rates per
// template instead of guessing from messageText. Silently ignored (not
// rejected) if the template no longer belongs to the user, since this is
// provenance metadata, not something that should block saving a campaign.
const resolveTemplateId = async (userId: string, templateId: unknown): Promise<string | null> => {
  if (typeof templateId !== 'string' || !templateId.trim()) return null;
  const template = await prisma.messageTemplate.findUnique({ where: { id: templateId }, select: { userId: true } });
  return template && template.userId === userId ? templateId : null;
};

const checkDuplicateName = async (userId: string, name: string, excludeId?: string): Promise<boolean> => {
  const existing = await prisma.campaign.findFirst({
    where: { userId, name: { equals: name, mode: 'insensitive' }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  return !!existing;
};

export const findOwnedCampaign = async (campaignId: string, userId: string) => {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.userId !== userId) throw new CampaignError('Campaign not found', 404);
  return campaign;
};

export const toPublicCampaignSummary = (campaign: any, createdByEmail: string | null) => ({
  id: campaign.id,
  name: campaign.name,
  description: campaign.description,
  type: campaign.type,
  status: campaign.status,
  sendStatus: campaign.sendStatus,
  scheduledAt: campaign.scheduledAt,
  timezone: campaign.timezone,
  templateId: campaign.templateId,
  createdBy: createdByEmail,
  createdAt: campaign.createdAt,
  updatedAt: campaign.updatedAt,
  recipientCount: campaign._count?.recipients ?? 0,
  hasAttachment: !!campaign.attachment,
});

const toPublicCampaignDetail = async (campaign: any) => {
  const ownerEmail = findUserById(campaign.userId)?.email ?? null;
  let attachment = null;
  if (campaign.attachment) {
    attachment = {
      id: campaign.attachment.id,
      type: campaign.attachment.type,
      originalFilename: campaign.attachment.originalFilename,
      mimeType: campaign.attachment.mimeType,
      fileSizeBytes: campaign.attachment.fileSizeBytes.toString(),
      previewUrl: await getPresignedViewUrl(campaign.attachment.storageKey),
    };
  }
  return {
    id: campaign.id,
    name: campaign.name,
    description: campaign.description,
    type: campaign.type,
    status: campaign.status,
    sendStatus: campaign.sendStatus,
    scheduledAt: campaign.scheduledAt,
    timezone: campaign.timezone,
    messageText: campaign.messageText,
    templateId: campaign.templateId,
    createdBy: ownerEmail,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
    recipientCount: campaign.recipients.length,
    recipients: campaign.recipients.map((r: any) => ({
      contactId: r.contact.id,
      name: r.contact.name,
      phoneNumber: r.contact.phoneNumber,
      source: r.source,
    })),
    attachment,
  };
};

export interface ListCampaignsOptions {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
}

export const listCampaigns = async (userId: string, options: ListCampaignsOptions) => {
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 25));

  if (options.status && !CAMPAIGN_STATUSES.includes(options.status as any)) {
    throw new CampaignError(`Invalid status filter: ${options.status}`, 400);
  }

  const where: any = { userId };
  if (options.search?.trim()) where.name = { contains: options.search.trim(), mode: 'insensitive' };
  if (options.status) where.status = options.status;

  const [campaigns, total] = await Promise.all([
    prisma.campaign.findMany({
      where,
      include: { attachment: { select: { id: true } }, _count: { select: { recipients: true } } },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.campaign.count({ where }),
  ]);

  const ownerEmail = findUserById(userId)?.email ?? null;
  return {
    campaigns: campaigns.map((c) => toPublicCampaignSummary(c, ownerEmail)),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
};

export const getCampaign = async (userId: string, campaignId: string) => {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, include: CAMPAIGN_INCLUDE });
  if (!campaign || campaign.userId !== userId) throw new CampaignError('Campaign not found', 404);
  return toPublicCampaignDetail(campaign);
};

export const createCampaign = async (userId: string, body: any) => {
  const name = sanitizeText(body?.name, NAME_MAX);
  if (!name) throw new CampaignError('Campaign name is required', 400);
  const description = sanitizeText(body?.description, DESCRIPTION_MAX);
  const type = validateType(body?.type);
  const messageText = validateMessageText(body?.messageText);
  const recipients = await validateRecipients(userId, body?.recipients);
  const templateId = await resolveTemplateId(userId, body?.templateId);
  const nameAlreadyExists = await checkDuplicateName(userId, name);

  const campaign = await prisma.campaign.create({
    data: {
      userId,
      name,
      description,
      type,
      status: 'DRAFT',
      messageText,
      templateId,
      recipients: { create: recipients.map((r) => ({ contactId: r.contactId, source: r.source })) },
    },
    include: CAMPAIGN_INCLUDE,
  });

  return { ...(await toPublicCampaignDetail(campaign)), nameAlreadyExists };
};

export const updateCampaign = async (userId: string, campaignId: string, body: any) => {
  await findOwnedCampaign(campaignId, userId);

  const name = sanitizeText(body?.name, NAME_MAX);
  if (!name) throw new CampaignError('Campaign name is required', 400);
  const description = sanitizeText(body?.description, DESCRIPTION_MAX);
  const type = validateType(body?.type);
  const messageText = validateMessageText(body?.messageText);
  const recipients = await validateRecipients(userId, body?.recipients);
  const templateId = await resolveTemplateId(userId, body?.templateId);
  const nameAlreadyExists = await checkDuplicateName(userId, name, campaignId);

  await prisma.$transaction([
    prisma.campaignRecipient.deleteMany({ where: { campaignId } }),
    prisma.campaign.update({
      where: { id: campaignId },
      data: {
        name,
        description,
        type,
        messageText,
        templateId,
        recipients: { create: recipients.map((r) => ({ contactId: r.contactId, source: r.source })) },
      },
    }),
  ]);

  const updated = await prisma.campaign.findUnique({ where: { id: campaignId }, include: CAMPAIGN_INCLUDE });
  return { ...(await toPublicCampaignDetail(updated)), nameAlreadyExists };
};

export const deleteCampaign = async (userId: string, campaignId: string) => {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, include: { attachment: true } });
  if (!campaign || campaign.userId !== userId) throw new CampaignError('Campaign not found', 404);
  if (campaign.attachment) await deleteFromR2([campaign.attachment.storageKey]);
  await prisma.campaign.delete({ where: { id: campaignId } });
};

export const duplicateCampaign = async (userId: string, campaignId: string) => {
  const original = await prisma.campaign.findUnique({ where: { id: campaignId }, include: CAMPAIGN_INCLUDE });
  if (!original || original.userId !== userId) throw new CampaignError('Campaign not found', 404);

  const newId = crypto.randomUUID();
  let attachmentCreate: any;
  if (original.attachment) {
    const ext = path.extname(original.attachment.originalFilename) || '';
    const destKey = getCampaignAttachmentKey(newId, `attachment${ext}`);
    await copyObjectInR2(original.attachment.storageKey, destKey);
    attachmentCreate = {
      create: {
        type: original.attachment.type,
        originalFilename: original.attachment.originalFilename,
        mimeType: original.attachment.mimeType,
        fileSizeBytes: original.attachment.fileSizeBytes,
        storageKey: destKey,
      },
    };
  }

  const duplicate = await prisma.campaign.create({
    data: {
      id: newId,
      userId,
      name: `${original.name} (Copy)`,
      description: original.description,
      type: original.type,
      status: 'DRAFT',
      messageText: original.messageText,
      templateId: original.templateId,
      recipients: { create: original.recipients.map((r) => ({ contactId: r.contactId, source: r.source })) },
      ...(attachmentCreate ? { attachment: attachmentCreate } : {}),
    },
    include: CAMPAIGN_INCLUDE,
  });

  return toPublicCampaignDetail(duplicate);
};

export const updateCampaignStatus = async (userId: string, campaignId: string, status: unknown) => {
  if (typeof status !== 'string' || !CAMPAIGN_STATUSES.includes(status as any)) {
    throw new CampaignError(`Invalid status: ${status}`, 400);
  }
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, include: { recipients: true } });
  if (!campaign || campaign.userId !== userId) throw new CampaignError('Campaign not found', 404);

  if (status === 'READY') {
    if (campaign.recipients.length === 0) {
      throw new CampaignError('Add at least one recipient before marking this campaign Ready', 400);
    }
    if (!campaign.messageText.trim()) {
      throw new CampaignError('Add a message before marking this campaign Ready', 400);
    }
    const availableKeys = await getAvailableVariableKeysCached(userId);
    const validation = validateTemplate(campaign.messageText, availableKeys);
    if (!validation.isValid) {
      const badVariable = validation.variables.find((v) => v.status === 'unknown');
      const malformedEntry = validation.malformed[0];
      const detail = badVariable
        ? `Unknown variable {{${badVariable.key}}}${badVariable.suggestion ? ` (did you mean {{${badVariable.suggestion}}}?)` : ''}`
        : malformedEntry
          ? `${malformedEntry.reason} ("${malformedEntry.snippet}")`
          : 'Message contains invalid variables';
      throw new CampaignError(`Fix the message before marking this campaign Ready: ${detail}`, 400);
    }
  }

  const updated = await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: status as any },
    include: CAMPAIGN_INCLUDE,
  });
  return toPublicCampaignDetail(updated);
};

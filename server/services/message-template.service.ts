import { prisma } from '../lib/prisma';
import { sanitizeText } from './contact.service';
import {
  MAX_MESSAGE_LENGTH,
  scanVariableTokens,
  validateTemplate,
  renderTemplate,
  getAvailableVariableKeysCached,
} from './template-engine.service';

export class MessageTemplateError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const NAME_MAX = 150;
const CATEGORIES = ['MARKETING', 'PROMOTION', 'REMINDER', 'GREETING', 'ANNOUNCEMENT', 'SUPPORT', 'INVOICE', 'OTP'] as const;

export const toPublicTemplate = (template: any) => ({
  id: template.id,
  name: template.name,
  category: template.category,
  messageText: template.messageText,
  isFavorite: template.isFavorite,
  createdAt: template.createdAt,
  updatedAt: template.updatedAt,
});

const validateCategory = (value: unknown): (typeof CATEGORIES)[number] => {
  if (value === undefined || value === null || value === '') return 'MARKETING';
  if (typeof value !== 'string' || !CATEGORIES.includes(value as any)) {
    throw new MessageTemplateError(`Invalid category: ${value}`, 400);
  }
  return value as (typeof CATEGORIES)[number];
};

// Draft-time save only checks message syntax (no unknown-variable rejection)
// - variable names are open-ended per-user data now, not a fixed allowlist.
const validateMessageSyntax = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new MessageTemplateError('Message is required', 400);
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new MessageTemplateError(`Message exceeds the maximum length of ${MAX_MESSAGE_LENGTH} characters`, 400);
  }
  const { malformed } = scanVariableTokens(trimmed);
  if (malformed.length > 0) {
    throw new MessageTemplateError(`Invalid variable syntax: ${malformed[0].reason} ("${malformed[0].snippet}")`, 400);
  }
  return trimmed;
};

const findOwnedTemplate = async (templateId: string, userId: string) => {
  const template = await prisma.messageTemplate.findUnique({ where: { id: templateId } });
  if (!template || template.userId !== userId) throw new MessageTemplateError('Template not found', 404);
  return template;
};

const checkDuplicateName = async (userId: string, name: string, excludeId?: string): Promise<boolean> => {
  const existing = await prisma.messageTemplate.findFirst({
    where: { userId, name: { equals: name, mode: 'insensitive' }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  return !!existing;
};

export interface ListTemplatesOptions {
  search?: string;
  category?: string;
  favoriteOnly?: boolean;
}

export const listTemplates = async (userId: string, options: ListTemplatesOptions) => {
  if (options.category && !CATEGORIES.includes(options.category as any)) {
    throw new MessageTemplateError(`Invalid category filter: ${options.category}`, 400);
  }
  const where: any = { userId };
  if (options.search?.trim()) where.name = { contains: options.search.trim(), mode: 'insensitive' };
  if (options.category) where.category = options.category;
  if (options.favoriteOnly) where.isFavorite = true;

  const templates = await prisma.messageTemplate.findMany({
    where,
    orderBy: [{ isFavorite: 'desc' }, { updatedAt: 'desc' }],
  });
  return templates.map(toPublicTemplate);
};

export const createTemplate = async (userId: string, body: any) => {
  const name = sanitizeText(body?.name, NAME_MAX);
  if (!name) throw new MessageTemplateError('Template name is required', 400);
  const category = validateCategory(body?.category);
  const messageText = validateMessageSyntax(body?.messageText);
  const nameAlreadyExists = await checkDuplicateName(userId, name);

  const template = await prisma.messageTemplate.create({
    data: { userId, name, category, messageText },
  });
  return { ...toPublicTemplate(template), nameAlreadyExists };
};

export const updateTemplate = async (userId: string, templateId: string, body: any) => {
  await findOwnedTemplate(templateId, userId);
  const name = sanitizeText(body?.name, NAME_MAX);
  if (!name) throw new MessageTemplateError('Template name is required', 400);
  const category = validateCategory(body?.category);
  const messageText = validateMessageSyntax(body?.messageText);
  const nameAlreadyExists = await checkDuplicateName(userId, name, templateId);

  const template = await prisma.messageTemplate.update({
    where: { id: templateId },
    data: { name, category, messageText },
  });
  return { ...toPublicTemplate(template), nameAlreadyExists };
};

export const deleteTemplate = async (userId: string, templateId: string) => {
  await findOwnedTemplate(templateId, userId);
  await prisma.messageTemplate.delete({ where: { id: templateId } });
};

export const duplicateTemplate = async (userId: string, templateId: string) => {
  const original = await findOwnedTemplate(templateId, userId);
  const template = await prisma.messageTemplate.create({
    data: {
      userId,
      name: `${original.name} (Copy)`,
      category: original.category,
      messageText: original.messageText,
      isFavorite: false,
    },
  });
  return toPublicTemplate(template);
};

export const setFavorite = async (userId: string, templateId: string, isFavorite: unknown) => {
  await findOwnedTemplate(templateId, userId);
  const template = await prisma.messageTemplate.update({
    where: { id: templateId },
    data: { isFavorite: Boolean(isFavorite) },
  });
  return toPublicTemplate(template);
};

export const getVariablesForUser = async (userId: string) => {
  return getAvailableVariableKeysCached(userId);
};

export const previewMessage = async (userId: string, body: any) => {
  const messageText = typeof body?.messageText === 'string' ? body.messageText : '';
  const contactId = typeof body?.contactId === 'string' ? body.contactId : undefined;

  const availableKeys = await getAvailableVariableKeysCached(userId);
  const validation = validateTemplate(messageText, availableKeys);

  let renderedText = messageText;
  if (contactId) {
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact || contact.userId !== userId) {
      throw new MessageTemplateError('Contact not found', 404);
    }
    renderedText = renderTemplate(messageText, contact);
  }

  return { renderedText, ...validation };
};

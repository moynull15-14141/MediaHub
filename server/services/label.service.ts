import { prisma } from '../lib/prisma';
import { sanitizeText } from './contact.service';

export class LabelError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const NAME_MAX = 100;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export const toPublicLabel = (label: any) => ({
  id: label.id,
  name: label.name,
  color: label.color,
  contactCount: label._count?.contacts ?? undefined,
  createdAt: label.createdAt,
  updatedAt: label.updatedAt,
});

const findOwnedLabel = async (labelId: string, userId: string) => {
  const label = await prisma.label.findUnique({ where: { id: labelId } });
  if (!label || label.userId !== userId) throw new LabelError('Label not found', 404);
  return label;
};

export const listLabels = async (userId: string, search?: string) => {
  const labels = await prisma.label.findMany({
    where: {
      userId,
      ...(search?.trim() ? { name: { contains: search.trim(), mode: 'insensitive' } } : {}),
    },
    include: { _count: { select: { contacts: true } } },
    orderBy: { name: 'asc' },
  });
  return labels.map(toPublicLabel);
};

const validateColor = (color: unknown): string | undefined => {
  if (color === undefined) return undefined;
  if (typeof color !== 'string' || !HEX_COLOR_PATTERN.test(color)) {
    throw new LabelError(`Invalid color: ${color}`, 400);
  }
  return color;
};

export const createLabel = async (userId: string, body: any) => {
  const name = sanitizeText(body?.name, NAME_MAX);
  if (!name) throw new LabelError('Label name is required', 400);
  const color = validateColor(body?.color);
  const existing = await prisma.label.findUnique({ where: { userId_name: { userId, name } } });
  if (existing) throw new LabelError('A label with this name already exists', 409);
  const label = await prisma.label.create({ data: { userId, name, ...(color ? { color } : {}) } });
  return toPublicLabel(label);
};

export const renameLabel = async (userId: string, labelId: string, body: any) => {
  await findOwnedLabel(labelId, userId);
  const data: { name?: string; color?: string } = {};
  if (body?.name !== undefined) {
    const name = sanitizeText(body.name, NAME_MAX);
    if (!name) throw new LabelError('Label name is required', 400);
    const existing = await prisma.label.findUnique({ where: { userId_name: { userId, name } } });
    if (existing && existing.id !== labelId) throw new LabelError('A label with this name already exists', 409);
    data.name = name;
  }
  const color = validateColor(body?.color);
  if (color) data.color = color;
  const label = await prisma.label.update({ where: { id: labelId }, data });
  return toPublicLabel(label);
};

export const deleteLabel = async (userId: string, labelId: string) => {
  await findOwnedLabel(labelId, userId);
  await prisma.label.delete({ where: { id: labelId } });
};

export const assignLabelsToContact = async (userId: string, contactId: string, labelIds: unknown) => {
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.userId !== userId) throw new LabelError('Contact not found', 404);
  if (!Array.isArray(labelIds) || !labelIds.every((id) => typeof id === 'string')) {
    throw new LabelError('labelIds must be an array', 400);
  }
  const ownedLabels = await prisma.label.findMany({ where: { id: { in: labelIds }, userId }, select: { id: true } });
  await prisma.$transaction([
    prisma.contactLabel.deleteMany({ where: { contactId } }),
    prisma.contactLabel.createMany({
      data: ownedLabels.map((l) => ({ contactId, labelId: l.id })),
      skipDuplicates: true,
    }),
  ]);
  return { labelCount: ownedLabels.length };
};

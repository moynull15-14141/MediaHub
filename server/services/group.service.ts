import { prisma } from '../lib/prisma';
import { sanitizeText } from './contact.service';

export class GroupError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const NAME_MAX = 100;

export const toPublicGroup = (group: any) => ({
  id: group.id,
  name: group.name,
  contactCount: group._count?.contacts ?? undefined,
  createdAt: group.createdAt,
  updatedAt: group.updatedAt,
});

const findOwnedGroup = async (groupId: string, userId: string) => {
  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group || group.userId !== userId) throw new GroupError('Group not found', 404);
  return group;
};

export const listGroups = async (userId: string, search?: string) => {
  const groups = await prisma.group.findMany({
    where: {
      userId,
      ...(search?.trim() ? { name: { contains: search.trim(), mode: 'insensitive' } } : {}),
    },
    include: { _count: { select: { contacts: true } } },
    orderBy: { name: 'asc' },
  });
  return groups.map(toPublicGroup);
};

export const createGroup = async (userId: string, body: any) => {
  const name = sanitizeText(body?.name, NAME_MAX);
  if (!name) throw new GroupError('Group name is required', 400);
  const existing = await prisma.group.findUnique({ where: { userId_name: { userId, name } } });
  if (existing) throw new GroupError('A group with this name already exists', 409);
  const group = await prisma.group.create({ data: { userId, name } });
  return toPublicGroup(group);
};

export const renameGroup = async (userId: string, groupId: string, body: any) => {
  await findOwnedGroup(groupId, userId);
  const name = sanitizeText(body?.name, NAME_MAX);
  if (!name) throw new GroupError('Group name is required', 400);
  const existing = await prisma.group.findUnique({ where: { userId_name: { userId, name } } });
  if (existing && existing.id !== groupId) throw new GroupError('A group with this name already exists', 409);
  const group = await prisma.group.update({ where: { id: groupId }, data: { name } });
  return toPublicGroup(group);
};

export const deleteGroup = async (userId: string, groupId: string) => {
  await findOwnedGroup(groupId, userId);
  await prisma.group.delete({ where: { id: groupId } });
};

const validateContactIds = (ids: unknown): string[] => {
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) {
    throw new GroupError('contactIds must be a non-empty array', 400);
  }
  return ids;
};

export const assignContacts = async (userId: string, groupId: string, contactIds: unknown) => {
  await findOwnedGroup(groupId, userId);
  const ids = validateContactIds(contactIds);
  const ownedContacts = await prisma.contact.findMany({ where: { id: { in: ids }, userId }, select: { id: true } });
  await prisma.contactGroup.createMany({
    data: ownedContacts.map((c) => ({ contactId: c.id, groupId })),
    skipDuplicates: true,
  });
  return { assignedCount: ownedContacts.length };
};

export const removeContacts = async (userId: string, groupId: string, contactIds: unknown) => {
  await findOwnedGroup(groupId, userId);
  const ids = validateContactIds(contactIds);
  const result = await prisma.contactGroup.deleteMany({ where: { groupId, contactId: { in: ids } } });
  return { removedCount: result.count };
};

import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

type PrismaTx = Prisma.TransactionClient;

export class WorkspaceError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const SLUG_INVALID_CHARS = /[^a-z0-9]/g;

// Mirrors the backfill logic used in the 20260802083834_add_workspace_foundation
// migration, so newly-registered users get slugs in the same shape as the
// ones existing accounts were migrated to.
const slugify = (email: string, userId: string): string => {
  const local = email.split('@')[0] || 'workspace';
  const base = local.toLowerCase().replace(SLUG_INVALID_CHARS, '') || 'workspace';
  return `${base}-${userId.slice(0, 8)}`;
};

const displayNameFromEmail = (email: string): string => {
  const local = email.split('@')[0] || 'My';
  const words = local.replace(/[._-]+/g, ' ').split(' ').filter(Boolean);
  const title = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || 'My';
  return `${title}'s Workspace`;
};

export const toPublicWorkspace = (workspace: any) => ({
  id: workspace.id,
  name: workspace.name,
  slug: workspace.slug,
  logo: workspace.logo,
  email: workspace.email,
  phone: workspace.phone,
  website: workspace.website,
  address: workspace.address,
  taxId: workspace.taxId,
  timezone: workspace.timezone,
  country: workspace.country,
  language: workspace.language,
  currency: workspace.currency,
  businessType: workspace.businessType,
  status: workspace.status,
  plan: workspace.plan,
  storageUsedBytes: workspace.storageUsedBytes?.toString?.() ?? String(workspace.storageUsedBytes),
  storageLimitBytes: workspace.storageLimitBytes?.toString?.() ?? String(workspace.storageLimitBytes),
  messageUsed: workspace.messageUsed,
  messageLimit: workspace.messageLimit,
  contactLimit: workspace.contactLimit,
  campaignLimit: workspace.campaignLimit,
  memberLimit: workspace.memberLimit,
  createdBy: workspace.createdBy,
  createdAt: workspace.createdAt,
  updatedAt: workspace.updatedAt,
});

// Creates a Workspace and its OWNER membership atomically. Accepts a caller-
// supplied transaction client so registerUser (user.service.ts) can run
// "create user + create workspace + create membership" as ONE transaction -
// a failure partway through must never leave a user with no workspace
// (locked out of every WhatsApp route) or a workspace with no owner.
export const createWorkspaceForUserTx = async (tx: PrismaTx, userId: string, email: string) => {
  const baseSlug = slugify(email, userId);
  const name = displayNameFromEmail(email);

  // Slug is globally unique; the email-derived base is already suffixed
  // with 8 chars of the user's own id, so a collision here would require
  // two different users to share both an email local-part and id prefix -
  // astronomically unlikely, but retry with a fuller suffix just in case.
  let slug = baseSlug;
  const existing = await tx.workspace.findUnique({ where: { slug } });
  if (existing) {
    slug = `${baseSlug}-${userId.slice(9, 13)}`;
  }

  const workspace = await tx.workspace.create({
    data: { name, slug, createdBy: userId },
  });

  await tx.workspaceMember.create({
    data: { workspaceId: workspace.id, userId, role: 'OWNER' },
  });

  await tx.user.update({ where: { id: userId }, data: { lastWorkspaceId: workspace.id } });

  return workspace;
};

export const createWorkspaceForUser = async (userId: string, email: string) => {
  return prisma.$transaction((tx) => createWorkspaceForUserTx(tx, userId, email));
};

export const listWorkspacesForUser = async (userId: string) => {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId, isActive: true },
    include: { workspace: true },
    orderBy: { joinedAt: 'asc' },
  });
  return memberships.map((m) => ({ ...toPublicWorkspace(m.workspace), role: m.role }));
};

export const getWorkspaceMember = async (workspaceId: string, userId: string) => {
  return prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
};

// Phase B.2 - owner-notification emails (account health failover, token
// expiring soon). Returns an array for forward-compatibility even though
// today's model has exactly one OWNER per workspace (Phase A.2).
export const getWorkspaceOwnerEmails = async (workspaceId: string): Promise<string[]> => {
  const owners = await prisma.workspaceMember.findMany({
    where: { workspaceId, role: 'OWNER', isActive: true },
    include: { user: { select: { email: true } } },
  });
  return owners.map((o) => o.user.email).filter((email): email is string => Boolean(email));
};

// Resolves "the workspace this request should operate on": the user's
// last-used workspace if they're still an active member of it, otherwise
// their earliest active membership. Every authenticated WhatsApp route uses
// this via the workspace middleware - never a client-supplied workspaceId.
export const getCurrentWorkspaceForUser = async (userId: string) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user?.lastWorkspaceId) {
    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: user.lastWorkspaceId, userId } },
      include: { workspace: true },
    });
    if (member?.isActive) return member;
  }

  return prisma.workspaceMember.findFirst({
    where: { userId, isActive: true },
    include: { workspace: true },
    orderBy: { joinedAt: 'asc' },
  });
};

// Part 7 (Workspace Switch) - architecture only, no UI yet. Verifies real
// membership before ever trusting a client-supplied workspaceId.
export const switchWorkspace = async (userId: string, workspaceId: string) => {
  const member = await getWorkspaceMember(workspaceId, userId);
  if (!member || !member.isActive) {
    throw new WorkspaceError('You are not a member of that workspace', 403);
  }
  await prisma.user.update({ where: { id: userId }, data: { lastWorkspaceId: workspaceId } });
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  return { workspace: workspace ? toPublicWorkspace(workspace) : null, role: member.role };
};

export const updateWorkspaceSettings = async (workspaceId: string, updates: Record<string, any>) => {
  const ALLOWED_FIELDS = [
    'name', 'logo', 'email', 'phone', 'website', 'address', 'taxId',
    'timezone', 'country', 'language', 'currency', 'businessType',
  ];
  const data: Record<string, any> = {};
  for (const key of ALLOWED_FIELDS) {
    if (updates[key] !== undefined) data[key] = updates[key];
  }
  if (Object.keys(data).length === 0) {
    throw new WorkspaceError('No valid fields to update', 400);
  }
  const workspace = await prisma.workspace.update({ where: { id: workspaceId }, data });
  return toPublicWorkspace(workspace);
};

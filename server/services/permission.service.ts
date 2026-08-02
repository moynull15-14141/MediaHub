import { prisma } from '../lib/prisma';
import { logAudit } from './whatsapp-audit.service';
import { getWorkspaceMember } from './workspace.service';

export class PermissionError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Permission catalog - the single source of truth, seeded into the
// Permission/RolePermission tables at server startup (idempotent upserts, so
// adding a new key here and restarting is all a future module needs to do -
// "future modules automatically inherit RBAC").
// ---------------------------------------------------------------------------

export interface PermissionDef {
  key: string;
  module: string;
  action: string;
  description: string;
}

export const PERMISSION_CATALOG: PermissionDef[] = [
  { key: 'contacts:read', module: 'contacts', action: 'read', description: 'View contacts' },
  { key: 'contacts:write', module: 'contacts', action: 'write', description: 'Create and edit contacts' },
  { key: 'contacts:delete', module: 'contacts', action: 'delete', description: 'Delete contacts' },

  { key: 'campaigns:read', module: 'campaigns', action: 'read', description: 'View campaigns' },
  { key: 'campaigns:write', module: 'campaigns', action: 'write', description: 'Create and edit campaigns, attachments' },
  { key: 'campaigns:delete', module: 'campaigns', action: 'delete', description: 'Delete campaigns' },
  { key: 'campaigns:send', module: 'campaigns', action: 'send', description: 'Send, pause, resume, or cancel a campaign' },

  { key: 'groups:read', module: 'groups', action: 'read', description: 'View groups' },
  { key: 'groups:write', module: 'groups', action: 'write', description: 'Create and edit groups' },
  { key: 'groups:delete', module: 'groups', action: 'delete', description: 'Delete groups' },

  { key: 'labels:read', module: 'labels', action: 'read', description: 'View labels' },
  { key: 'labels:write', module: 'labels', action: 'write', description: 'Create and edit labels' },
  { key: 'labels:delete', module: 'labels', action: 'delete', description: 'Delete labels' },

  { key: 'templates:read', module: 'templates', action: 'read', description: 'View message templates' },
  { key: 'templates:write', module: 'templates', action: 'write', description: 'Create and edit templates' },
  { key: 'templates:delete', module: 'templates', action: 'delete', description: 'Delete templates' },

  { key: 'analytics:read', module: 'analytics', action: 'read', description: 'View analytics and charts' },

  { key: 'reports:read', module: 'reports', action: 'read', description: 'View and download reports' },
  { key: 'reports:write', module: 'reports', action: 'write', description: 'Generate or schedule reports' },

  { key: 'settings:read', module: 'settings', action: 'read', description: 'View WhatsApp account settings' },
  { key: 'settings:write', module: 'settings', action: 'write', description: 'Change WhatsApp account settings' },

  { key: 'workspace:read', module: 'workspace', action: 'read', description: 'View workspace/organization info' },
  { key: 'workspace:write', module: 'workspace', action: 'write', description: 'Edit workspace/organization info' },
  { key: 'workspace:delete', module: 'workspace', action: 'delete', description: 'Delete the workspace' },
  { key: 'workspace:transfer_ownership', module: 'workspace', action: 'transfer_ownership', description: 'Transfer workspace ownership' },

  { key: 'billing:manage', module: 'billing', action: 'manage', description: 'Manage billing and subscription' },

  { key: 'members:read', module: 'members', action: 'read', description: 'View workspace members' },
  { key: 'members:write', module: 'members', action: 'write', description: 'Invite, remove, suspend, or change the role of members' },
];

const ALL_KEYS = PERMISSION_CATALOG.map((p) => p.key);
const READ_KEYS = PERMISSION_CATALOG.filter((p) => p.action === 'read').map((p) => p.key);
// Manager/Operator's module list per spec is exactly {contacts, campaigns,
// templates} (+ analytics:read for Manager only) - notably not groups/
// labels/reports/settings, matching the brief's literal role breakdown.
const OPERATIONAL_MODULES = new Set(['contacts', 'campaigns', 'templates']);

export const ROLE_PERMISSION_MATRIX: Record<string, string[]> = {
  OWNER: ALL_KEYS,
  ADMIN: ALL_KEYS.filter((k) => !['workspace:delete', 'workspace:transfer_ownership', 'billing:manage'].includes(k)),
  MANAGER: PERMISSION_CATALOG.filter((p) => OPERATIONAL_MODULES.has(p.module) || p.key === 'analytics:read').map((p) => p.key),
  OPERATOR: PERMISSION_CATALOG.filter((p) => OPERATIONAL_MODULES.has(p.module)).map((p) => p.key),
  VIEWER: READ_KEYS,
};

// Idempotent - safe to call on every server start. Upserts the catalog and
// the default role matrix; never touches UserPermission (per-user overrides
// are operator-created, not part of the seeded defaults).
export const seedPermissions = async (): Promise<void> => {
  for (const def of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { key: def.key },
      create: def,
      update: { module: def.module, action: def.action, description: def.description },
    });
  }

  const permissions = await prisma.permission.findMany({ select: { id: true, key: true } });
  const idByKey = new Map(permissions.map((p) => [p.key, p.id]));

  for (const [role, keys] of Object.entries(ROLE_PERMISSION_MATRIX)) {
    for (const key of keys) {
      const permissionId = idByKey.get(key);
      if (!permissionId) continue;
      await prisma.rolePermission.upsert({
        where: { role_permissionId: { role: role as any, permissionId } },
        create: { role: role as any, permissionId },
        update: {},
      });
    }
  }
  console.log(`Permissions seeded: ${permissions.length} keys, ${Object.keys(ROLE_PERMISSION_MATRIX).length} roles`);
};

// ---------------------------------------------------------------------------
// Resolver - role defaults plus per-user overrides, cached in-process for a
// short TTL per (workspaceId, userId), mirroring the exact pattern already
// used by getAvailableVariableKeysCached in template-engine.service.ts.
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 30_000;
const permissionCache = new Map<string, { keys: Set<string>; expiresAt: number }>();
const cacheKey = (workspaceId: string, userId: string) => `${workspaceId}:${userId}`;

export const invalidatePermissionCache = (workspaceId: string, userId: string): void => {
  permissionCache.delete(cacheKey(workspaceId, userId));
};

export const resolvePermissions = async (workspaceId: string, userId: string, role: string): Promise<Set<string>> => {
  const key = cacheKey(workspaceId, userId);
  const cached = permissionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.keys;

  const [rolePermissions, userOverrides] = await Promise.all([
    prisma.rolePermission.findMany({ where: { role: role as any }, include: { permission: true } }),
    prisma.userPermission.findMany({ where: { workspaceId, userId }, include: { permission: true } }),
  ]);

  const keys = new Set(rolePermissions.map((rp) => rp.permission.key));
  for (const override of userOverrides) {
    if (override.grant) keys.add(override.permission.key);
    else keys.delete(override.permission.key);
  }

  permissionCache.set(key, { keys, expiresAt: Date.now() + CACHE_TTL_MS });
  return keys;
};

export const hasPermission = async (workspaceId: string, userId: string, role: string, permissionKey: string): Promise<boolean> => {
  const keys = await resolvePermissions(workspaceId, userId, role);
  return keys.has(permissionKey);
};

// ---------------------------------------------------------------------------
// Team management (Part: TEAM MANAGEMENT) - backend only, per the brief
// ("UI optional"). Every mutation is audit-logged per the brief's explicit
// AUDIT requirements (role changes, member invite/removal, ownership
// transfer) by reusing the existing logAudit from Phase A.2/A.3's audit log.
// ---------------------------------------------------------------------------

const ROLE_VALUES = ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'] as const;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const listMembers = async (workspaceId: string) => {
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    orderBy: { joinedAt: 'asc' },
  });
  const users = await prisma.user.findMany({ where: { id: { in: members.map((m) => m.userId) } }, select: { id: true, email: true } });
  const emailById = new Map(users.map((u) => [u.id, u.email]));
  return members.map((m) => ({
    id: m.id,
    userId: m.userId,
    email: emailById.get(m.userId) ?? null,
    role: m.role,
    isActive: m.isActive,
    joinedAt: m.joinedAt,
  }));
};

export const inviteMember = async (workspaceId: string, invitedByUserId: string, email: string, role: string) => {
  const normalizedEmail = email.toLowerCase().trim();
  if (!normalizedEmail || !normalizedEmail.includes('@')) throw new PermissionError('A valid email is required', 400);
  if (!ROLE_VALUES.includes(role as any)) throw new PermissionError(`Invalid role: ${role}`, 400);
  if (role === 'OWNER') throw new PermissionError('Invite as Admin or below - use Transfer Ownership to make someone the Owner', 400);

  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const invitation = await prisma.workspaceInvitation.create({
    data: {
      workspaceId,
      email: normalizedEmail,
      role: role as any,
      token,
      invitedBy: invitedByUserId,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  });
  await logAudit(invitedByUserId, 'MEMBER_INVITED', `${normalizedEmail} as ${role}`);
  return invitation;
};

export const removeMember = async (workspaceId: string, actingUserId: string, targetUserId: string) => {
  const target = await getWorkspaceMember(workspaceId, targetUserId);
  if (!target) throw new PermissionError('Member not found', 404);
  if (target.role === 'OWNER') throw new PermissionError('The workspace owner cannot be removed - transfer ownership first', 400);
  if (targetUserId === actingUserId) throw new PermissionError('You cannot remove yourself - transfer ownership or delete the workspace instead', 400);

  await prisma.workspaceMember.delete({ where: { id: target.id } });
  invalidatePermissionCache(workspaceId, targetUserId);
  await logAudit(actingUserId, 'MEMBER_REMOVED', targetUserId);
};

export const setMemberSuspended = async (workspaceId: string, actingUserId: string, targetUserId: string, suspended: boolean) => {
  const target = await getWorkspaceMember(workspaceId, targetUserId);
  if (!target) throw new PermissionError('Member not found', 404);
  if (target.role === 'OWNER') throw new PermissionError('The workspace owner cannot be suspended', 400);

  await prisma.workspaceMember.update({ where: { id: target.id }, data: { isActive: !suspended } });
  invalidatePermissionCache(workspaceId, targetUserId);
  await logAudit(actingUserId, suspended ? 'MEMBER_SUSPENDED' : 'MEMBER_REACTIVATED', targetUserId);
};

export const changeMemberRole = async (workspaceId: string, actingUserId: string, targetUserId: string, newRole: string) => {
  if (!ROLE_VALUES.includes(newRole as any)) throw new PermissionError(`Invalid role: ${newRole}`, 400);
  if (newRole === 'OWNER') throw new PermissionError('Use Transfer Ownership to make someone the Owner', 400);
  const target = await getWorkspaceMember(workspaceId, targetUserId);
  if (!target) throw new PermissionError('Member not found', 404);
  if (target.role === 'OWNER') throw new PermissionError("The workspace owner's role cannot be changed - transfer ownership first", 400);

  const updated = await prisma.workspaceMember.update({ where: { id: target.id }, data: { role: newRole as any } });
  invalidatePermissionCache(workspaceId, targetUserId);
  await logAudit(actingUserId, 'MEMBER_ROLE_CHANGED', `${targetUserId}: ${target.role} -> ${newRole}`);
  return updated;
};

// Only the current Owner may call this (enforced by requireWorkspaceRole('OWNER')
// at the route level) - swaps OWNER and the target member's prior role atomically.
export const transferOwnership = async (workspaceId: string, currentOwnerUserId: string, newOwnerUserId: string) => {
  const newOwnerMember = await getWorkspaceMember(workspaceId, newOwnerUserId);
  if (!newOwnerMember || !newOwnerMember.isActive) throw new PermissionError('Target user is not an active member of this workspace', 400);
  const currentOwnerMember = await getWorkspaceMember(workspaceId, currentOwnerUserId);
  if (!currentOwnerMember || currentOwnerMember.role !== 'OWNER') throw new PermissionError('Only the current owner can transfer ownership', 403);

  await prisma.$transaction([
    prisma.workspaceMember.update({ where: { id: currentOwnerMember.id }, data: { role: 'ADMIN' } }),
    prisma.workspaceMember.update({ where: { id: newOwnerMember.id }, data: { role: 'OWNER' } }),
    prisma.workspace.update({ where: { id: workspaceId }, data: { createdBy: newOwnerUserId } }),
  ]);
  invalidatePermissionCache(workspaceId, currentOwnerUserId);
  invalidatePermissionCache(workspaceId, newOwnerUserId);
  await logAudit(currentOwnerUserId, 'OWNERSHIP_TRANSFERRED', `to ${newOwnerUserId}`);
};

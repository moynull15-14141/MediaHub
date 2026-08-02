import { Request, Response, NextFunction } from 'express';
import { getCurrentWorkspaceForUser, getWorkspaceMember } from '../services/workspace.service';
import { hasPermission } from '../services/permission.service';
import { logAudit } from '../services/whatsapp-audit.service';
import { getUserId } from './require-auth';

// Role hierarchy for permission checks - higher index outranks lower.
const ROLE_RANK: Record<string, number> = {
  VIEWER: 0,
  OPERATOR: 1,
  MANAGER: 2,
  ADMIN: 3,
  OWNER: 4,
};

export const getWorkspaceId = (req: Request): string => (req as any).workspaceId as string;
export const getWorkspace = (req: Request): any => (req as any).workspace;
export const getWorkspaceMemberRole = (req: Request): string => (req as any).workspaceMember?.role as string;

// Resolves the current request's workspace strictly from the authenticated
// user's own membership records - never from a client-supplied header, query
// param, or body field. Must run after requireAuth (needs req.userId).
// Exposes req.workspace and req.workspaceMember for every downstream
// WhatsApp handler, matching Phase A.2 Part 6.
export const resolveWorkspace = async (req: Request, res: Response, next: NextFunction) => {
  const userId = getUserId(req);
  const member = await getCurrentWorkspaceForUser(userId);
  if (!member || !member.workspace) {
    res.status(403).json({ error: 'No workspace found for this account' });
    return;
  }

  (req as any).workspaceId = member.workspaceId;
  (req as any).workspace = member.workspace;
  (req as any).workspaceMember = member;
  next();
};

// Verifies a specific workspaceId (e.g. from a route param on a future
// multi-workspace endpoint) actually belongs to the authenticated user,
// rejecting cross-workspace access instead of trusting the value. Must run
// after requireAuth.
export const requireWorkspaceOwnership = (workspaceIdFromRequest: (req: Request) => string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = getUserId(req);
    const workspaceId = workspaceIdFromRequest(req);
    if (!workspaceId) {
      res.status(400).json({ error: 'Missing workspace id' });
      return;
    }
    const member = await getWorkspaceMember(workspaceId, userId);
    if (!member || !member.isActive) {
      res.status(403).json({ error: 'You do not have access to this workspace' });
      return;
    }
    (req as any).workspaceId = workspaceId;
    (req as any).workspaceMember = member;
    next();
  };
};

// Role gate for write/admin operations - must run after resolveWorkspace.
export const requireWorkspaceRole = (minimumRole: keyof typeof ROLE_RANK) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = getWorkspaceMemberRole(req);
    if (!role || ROLE_RANK[role] === undefined || ROLE_RANK[role] < ROLE_RANK[minimumRole]) {
      void logAudit(getUserId(req), 'PERMISSION_DENIED', `role<${minimumRole} on ${req.method} ${req.originalUrl}`);
      res.status(403).json({ error: 'You do not have permission to perform this action' });
      return;
    }
    next();
  };
};

// Fine-grained permission gate (Phase A.3) - must run after resolveWorkspace.
// Checks the requesting member's resolved permission set (role defaults +
// any per-user overrides), never a client-supplied claim. Every denial is
// audit-logged per the brief's explicit "Log: Permission denied" requirement.
export const requirePermission = (permissionKey: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = getUserId(req);
    const workspaceId = getWorkspaceId(req);
    const role = getWorkspaceMemberRole(req);
    if (!workspaceId || !role) {
      res.status(403).json({ error: 'No workspace found for this account' });
      return;
    }
    const allowed = await hasPermission(workspaceId, userId, role, permissionKey);
    if (!allowed) {
      void logAudit(userId, 'PERMISSION_DENIED', `${permissionKey} on ${req.method} ${req.originalUrl}`);
      res.status(403).json({ error: 'You do not have permission to perform this action' });
      return;
    }
    next();
  };
};

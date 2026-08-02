import { Request, Response } from 'express';
import { getUserId } from '../lib/require-auth';
import { getWorkspaceId, getWorkspaceMemberRole } from '../lib/require-workspace';
import {
  listMembers,
  inviteMember,
  removeMember,
  setMemberSuspended,
  changeMemberRole,
  transferOwnership,
  resolvePermissions,
  PermissionError,
} from '../services/permission.service';

const handleError = (err: any, res: Response, fallback: string) => {
  if (err instanceof PermissionError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(fallback, err);
  res.status(500).json({ error: fallback });
};

// Backs the frontend's usePermissions() hook (Phase A.3, Part: FRONTEND) -
// hiding/disabling a button based on this is a UX nicety only, since every
// route is independently enforced server-side regardless of what the
// frontend does with this response ("never trust frontend").
export const myPermissionsHandler = async (req: Request, res: Response) => {
  try {
    const role = getWorkspaceMemberRole(req);
    const keys = await resolvePermissions(getWorkspaceId(req), getUserId(req), role);
    res.json({ role, permissions: Array.from(keys) });
  } catch (err) {
    handleError(err, res, 'Failed to load permissions');
  }
};

export const listMembersHandler = async (req: Request, res: Response) => {
  try {
    res.json(await listMembers(getWorkspaceId(req)));
  } catch (err) {
    handleError(err, res, 'Failed to list members');
  }
};

export const inviteMemberHandler = async (req: Request, res: Response) => {
  try {
    const invitation = await inviteMember(getWorkspaceId(req), getUserId(req), req.body?.email, req.body?.role);
    res.status(201).json(invitation);
  } catch (err) {
    handleError(err, res, 'Failed to invite member');
  }
};

export const removeMemberHandler = async (req: Request, res: Response) => {
  try {
    await removeMember(getWorkspaceId(req), getUserId(req), req.params.userId);
    res.status(204).send();
  } catch (err) {
    handleError(err, res, 'Failed to remove member');
  }
};

export const suspendMemberHandler = async (req: Request, res: Response) => {
  try {
    await setMemberSuspended(getWorkspaceId(req), getUserId(req), req.params.userId, true);
    res.json({ status: 'ok' });
  } catch (err) {
    handleError(err, res, 'Failed to suspend member');
  }
};

export const reactivateMemberHandler = async (req: Request, res: Response) => {
  try {
    await setMemberSuspended(getWorkspaceId(req), getUserId(req), req.params.userId, false);
    res.json({ status: 'ok' });
  } catch (err) {
    handleError(err, res, 'Failed to reactivate member');
  }
};

export const changeMemberRoleHandler = async (req: Request, res: Response) => {
  try {
    const updated = await changeMemberRole(getWorkspaceId(req), getUserId(req), req.params.userId, req.body?.role);
    res.json(updated);
  } catch (err) {
    handleError(err, res, 'Failed to change member role');
  }
};

export const transferOwnershipHandler = async (req: Request, res: Response) => {
  try {
    await transferOwnership(getWorkspaceId(req), getUserId(req), req.body?.newOwnerUserId);
    res.json({ status: 'ok' });
  } catch (err) {
    handleError(err, res, 'Failed to transfer ownership');
  }
};

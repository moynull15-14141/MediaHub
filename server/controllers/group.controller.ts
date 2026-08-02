import { Request, Response } from 'express';
import { getUserId } from '../lib/require-auth';
import { listGroups, createGroup, renameGroup, deleteGroup, assignContacts, removeContacts, GroupError } from '../services/group.service';

const handleGroupError = (err: any, res: Response, fallback: string) => {
  if (err instanceof GroupError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(fallback, err);
  res.status(500).json({ error: fallback });
};

export const listHandler = async (req: Request, res: Response) => {
  try {
    const groups = await listGroups(getUserId(req), typeof req.query.search === 'string' ? req.query.search : undefined);
    res.json(groups);
  } catch (err) {
    handleGroupError(err, res, 'Failed to list groups');
  }
};

export const createHandler = async (req: Request, res: Response) => {
  try {
    const group = await createGroup(getUserId(req), req.body);
    res.status(201).json(group);
  } catch (err) {
    handleGroupError(err, res, 'Failed to create group');
  }
};

export const renameHandler = async (req: Request, res: Response) => {
  try {
    const group = await renameGroup(getUserId(req), req.params.id, req.body);
    res.json(group);
  } catch (err) {
    handleGroupError(err, res, 'Failed to rename group');
  }
};

export const deleteHandler = async (req: Request, res: Response) => {
  try {
    await deleteGroup(getUserId(req), req.params.id);
    res.status(204).send();
  } catch (err) {
    handleGroupError(err, res, 'Failed to delete group');
  }
};

export const assignContactsHandler = async (req: Request, res: Response) => {
  try {
    const result = await assignContacts(getUserId(req), req.params.id, req.body?.contactIds);
    res.json(result);
  } catch (err) {
    handleGroupError(err, res, 'Failed to assign contacts');
  }
};

export const removeContactsHandler = async (req: Request, res: Response) => {
  try {
    const result = await removeContacts(getUserId(req), req.params.id, req.body?.contactIds);
    res.json(result);
  } catch (err) {
    handleGroupError(err, res, 'Failed to remove contacts');
  }
};

import { Request, Response } from 'express';
import { getUserId } from '../lib/require-auth';
import { getWorkspaceId } from '../lib/require-workspace';
import {
  listContacts,
  createContact,
  updateContact,
  deleteContact,
  bulkDeleteContacts,
  ContactError,
} from '../services/contact.service';

const handleContactError = (err: any, res: Response, fallback: string) => {
  if (err instanceof ContactError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(fallback, err);
  res.status(500).json({ error: fallback });
};

export const listHandler = async (req: Request, res: Response) => {
  try {
    const { page, pageSize, search, status, groupId, labelId } = req.query;
    const result = await listContacts(getWorkspaceId(req), {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      search: typeof search === 'string' ? search : undefined,
      status: typeof status === 'string' ? status : undefined,
      groupId: typeof groupId === 'string' ? groupId : undefined,
      labelId: typeof labelId === 'string' ? labelId : undefined,
    });
    res.json(result);
  } catch (err) {
    handleContactError(err, res, 'Failed to list contacts');
  }
};

export const createHandler = async (req: Request, res: Response) => {
  try {
    const contact = await createContact(getWorkspaceId(req), getUserId(req), req.body);
    res.status(201).json(contact);
  } catch (err) {
    handleContactError(err, res, 'Failed to create contact');
  }
};

export const updateHandler = async (req: Request, res: Response) => {
  try {
    const contact = await updateContact(getWorkspaceId(req), req.params.id, req.body);
    res.json(contact);
  } catch (err) {
    handleContactError(err, res, 'Failed to update contact');
  }
};

export const deleteHandler = async (req: Request, res: Response) => {
  try {
    await deleteContact(getWorkspaceId(req), req.params.id);
    res.status(204).send();
  } catch (err) {
    handleContactError(err, res, 'Failed to delete contact');
  }
};

export const bulkDeleteHandler = async (req: Request, res: Response) => {
  try {
    const result = await bulkDeleteContacts(getWorkspaceId(req), req.body?.ids);
    res.json(result);
  } catch (err) {
    handleContactError(err, res, 'Failed to bulk delete contacts');
  }
};

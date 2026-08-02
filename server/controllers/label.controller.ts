import { Request, Response } from 'express';
import { getUserId } from '../lib/require-auth';
import { listLabels, createLabel, renameLabel, deleteLabel, assignLabelsToContact, LabelError } from '../services/label.service';

const handleLabelError = (err: any, res: Response, fallback: string) => {
  if (err instanceof LabelError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(fallback, err);
  res.status(500).json({ error: fallback });
};

export const listHandler = async (req: Request, res: Response) => {
  try {
    const labels = await listLabels(getUserId(req), typeof req.query.search === 'string' ? req.query.search : undefined);
    res.json(labels);
  } catch (err) {
    handleLabelError(err, res, 'Failed to list labels');
  }
};

export const createHandler = async (req: Request, res: Response) => {
  try {
    const label = await createLabel(getUserId(req), req.body);
    res.status(201).json(label);
  } catch (err) {
    handleLabelError(err, res, 'Failed to create label');
  }
};

export const renameHandler = async (req: Request, res: Response) => {
  try {
    const label = await renameLabel(getUserId(req), req.params.id, req.body);
    res.json(label);
  } catch (err) {
    handleLabelError(err, res, 'Failed to update label');
  }
};

export const deleteHandler = async (req: Request, res: Response) => {
  try {
    await deleteLabel(getUserId(req), req.params.id);
    res.status(204).send();
  } catch (err) {
    handleLabelError(err, res, 'Failed to delete label');
  }
};

export const assignToContactHandler = async (req: Request, res: Response) => {
  try {
    const result = await assignLabelsToContact(getUserId(req), req.params.id, req.body?.labelIds);
    res.json(result);
  } catch (err) {
    handleLabelError(err, res, 'Failed to assign labels');
  }
};

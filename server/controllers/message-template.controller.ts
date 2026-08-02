import { Request, Response } from 'express';
import { getUserId } from '../lib/require-auth';
import {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  duplicateTemplate,
  setFavorite,
  getVariablesForUser,
  previewMessage,
  MessageTemplateError,
} from '../services/message-template.service';

const handleTemplateError = (err: any, res: Response, fallback: string) => {
  if (err instanceof MessageTemplateError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(fallback, err);
  res.status(500).json({ error: fallback });
};

export const listHandler = async (req: Request, res: Response) => {
  try {
    const { search, category, favorite } = req.query;
    const templates = await listTemplates(getUserId(req), {
      search: typeof search === 'string' ? search : undefined,
      category: typeof category === 'string' ? category : undefined,
      favoriteOnly: favorite === 'true',
    });
    res.json(templates);
  } catch (err) {
    handleTemplateError(err, res, 'Failed to list templates');
  }
};

export const createHandler = async (req: Request, res: Response) => {
  try {
    const template = await createTemplate(getUserId(req), req.body);
    res.status(201).json(template);
  } catch (err) {
    handleTemplateError(err, res, 'Failed to create template');
  }
};

export const updateHandler = async (req: Request, res: Response) => {
  try {
    const template = await updateTemplate(getUserId(req), req.params.id, req.body);
    res.json(template);
  } catch (err) {
    handleTemplateError(err, res, 'Failed to update template');
  }
};

export const deleteHandler = async (req: Request, res: Response) => {
  try {
    await deleteTemplate(getUserId(req), req.params.id);
    res.status(204).send();
  } catch (err) {
    handleTemplateError(err, res, 'Failed to delete template');
  }
};

export const duplicateHandler = async (req: Request, res: Response) => {
  try {
    const template = await duplicateTemplate(getUserId(req), req.params.id);
    res.status(201).json(template);
  } catch (err) {
    handleTemplateError(err, res, 'Failed to duplicate template');
  }
};

export const favoriteHandler = async (req: Request, res: Response) => {
  try {
    const template = await setFavorite(getUserId(req), req.params.id, req.body?.isFavorite);
    res.json(template);
  } catch (err) {
    handleTemplateError(err, res, 'Failed to update favorite');
  }
};

export const variablesHandler = async (req: Request, res: Response) => {
  try {
    const variables = await getVariablesForUser(getUserId(req));
    res.json(variables);
  } catch (err) {
    handleTemplateError(err, res, 'Failed to load variables');
  }
};

export const previewHandler = async (req: Request, res: Response) => {
  try {
    const result = await previewMessage(getUserId(req), req.body);
    res.json(result);
  } catch (err) {
    handleTemplateError(err, res, 'Failed to render preview');
  }
};

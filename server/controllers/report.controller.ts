import { Request, Response } from 'express';
import { getUserId } from '../lib/require-auth';
import {
  ReportError,
  listScheduledReports,
  createScheduledReport,
  updateScheduledReport,
  deleteScheduledReport,
  generateReport,
  listReportHistory,
  getReportDownloadUrl,
  deleteReportHistory,
} from '../services/scheduled-report.service';
import { EXPORT_DATASETS, EXPORT_FORMATS, ExportDataset, ExportFormat } from '../services/analytics-export.service';
import { parseAnalyticsFilters, AnalyticsFilterError } from '../services/analytics-filters';

const handleError = (err: unknown, res: Response, fallback: string) => {
  if (err instanceof ReportError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof AnalyticsFilterError) {
    res.status(400).json({ error: err.message });
    return;
  }
  console.error(fallback, err);
  res.status(500).json({ error: fallback });
};

export const listScheduledHandler = async (req: Request, res: Response) => {
  try {
    res.json(await listScheduledReports(getUserId(req)));
  } catch (err) {
    handleError(err, res, 'Failed to load scheduled reports');
  }
};

export const createScheduledHandler = async (req: Request, res: Response) => {
  try {
    res.status(201).json(await createScheduledReport(getUserId(req), req.body));
  } catch (err) {
    handleError(err, res, 'Failed to create scheduled report');
  }
};

export const updateScheduledHandler = async (req: Request, res: Response) => {
  try {
    res.json(await updateScheduledReport(getUserId(req), req.params.id, req.body));
  } catch (err) {
    handleError(err, res, 'Failed to update scheduled report');
  }
};

export const deleteScheduledHandler = async (req: Request, res: Response) => {
  try {
    await deleteScheduledReport(getUserId(req), req.params.id);
    res.status(204).send();
  } catch (err) {
    handleError(err, res, 'Failed to delete scheduled report');
  }
};

export const generateNowHandler = async (req: Request, res: Response) => {
  try {
    const dataset = req.body?.dataset;
    const format = req.body?.format;
    if (!EXPORT_DATASETS.includes(dataset)) {
      res.status(400).json({ error: `Invalid dataset: ${dataset}` });
      return;
    }
    if (!EXPORT_FORMATS.includes(format)) {
      res.status(400).json({ error: `Invalid format: ${format}` });
      return;
    }
    const filters = parseAnalyticsFilters(req.body?.filters ?? {});
    const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : `${dataset} Report`;
    const history = await generateReport(getUserId(req), { name, dataset: dataset as ExportDataset, format: format as ExportFormat, filters });
    res.status(201).json(history);
  } catch (err) {
    handleError(err, res, 'Failed to generate report');
  }
};

export const listHistoryHandler = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    res.json(await listReportHistory(getUserId(req), page, pageSize));
  } catch (err) {
    handleError(err, res, 'Failed to load report history');
  }
};

export const downloadHistoryHandler = async (req: Request, res: Response) => {
  try {
    const { url } = await getReportDownloadUrl(getUserId(req), req.params.id);
    res.json({ url });
  } catch (err) {
    handleError(err, res, 'Failed to generate download link');
  }
};

export const deleteHistoryHandler = async (req: Request, res: Response) => {
  try {
    await deleteReportHistory(getUserId(req), req.params.id);
    res.status(204).send();
  } catch (err) {
    handleError(err, res, 'Failed to delete report');
  }
};

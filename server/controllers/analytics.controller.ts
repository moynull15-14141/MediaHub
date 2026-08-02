import { Request, Response } from 'express';
import { getUserId } from '../lib/require-auth';
import { parseAnalyticsFilters, AnalyticsFilterError } from '../services/analytics-filters';
import { getOverview } from '../services/analytics-overview.service';
import { listCampaignAnalytics, getCampaignAnalyticsDetail, AnalyticsError } from '../services/analytics-campaigns.service';
import { getContactAnalytics } from '../services/analytics-contacts.service';
import { getTemplateAnalytics } from '../services/analytics-templates.service';
import { getQueueAnalytics } from '../services/analytics-queue.service';
import { getApiAnalytics } from '../services/analytics-api.service';
import { getWebhookAnalytics } from '../services/analytics-webhook.service';
import { getChartData, isValidMetric, ChartGranularity } from '../services/analytics-charts.service';
import { buildExportTable, renderExport, EXPORT_DATASETS, EXPORT_FORMATS, EXPORT_SCOPES, ExportDataset, ExportFormat, ExportScope } from '../services/analytics-export.service';

const handleError = (err: unknown, res: Response, fallback: string) => {
  if (err instanceof AnalyticsFilterError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof AnalyticsError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(fallback, err);
  res.status(500).json({ error: fallback });
};

export const overviewHandler = async (req: Request, res: Response) => {
  try {
    const filters = parseAnalyticsFilters(req.query);
    res.json(await getOverview(getUserId(req), filters));
  } catch (err) {
    handleError(err, res, 'Failed to load overview analytics');
  }
};

export const campaignsListHandler = async (req: Request, res: Response) => {
  try {
    const filters = parseAnalyticsFilters(req.query);
    res.json(await listCampaignAnalytics(getUserId(req), { ...filters, page: Number(req.query.page), pageSize: Number(req.query.pageSize) }));
  } catch (err) {
    handleError(err, res, 'Failed to load campaign analytics');
  }
};

export const campaignDetailHandler = async (req: Request, res: Response) => {
  try {
    res.json(await getCampaignAnalyticsDetail(getUserId(req), req.params.id));
  } catch (err) {
    handleError(err, res, 'Failed to load campaign analytics detail');
  }
};

export const contactsHandler = async (req: Request, res: Response) => {
  try {
    const filters = parseAnalyticsFilters(req.query);
    res.json(await getContactAnalytics(getUserId(req), filters.dateFrom, filters.dateTo));
  } catch (err) {
    handleError(err, res, 'Failed to load contact analytics');
  }
};

export const templatesHandler = async (req: Request, res: Response) => {
  try {
    res.json(await getTemplateAnalytics(getUserId(req)));
  } catch (err) {
    handleError(err, res, 'Failed to load template analytics');
  }
};

export const queueHandler = async (req: Request, res: Response) => {
  try {
    const campaignId = typeof req.query.campaignId === 'string' ? req.query.campaignId : undefined;
    res.json(await getQueueAnalytics(getUserId(req), campaignId));
  } catch (err) {
    handleError(err, res, 'Failed to load queue analytics');
  }
};

export const apiAnalyticsHandler = async (req: Request, res: Response) => {
  try {
    const filters = parseAnalyticsFilters(req.query);
    res.json(await getApiAnalytics(getUserId(req), filters.dateFrom, filters.dateTo));
  } catch (err) {
    handleError(err, res, 'Failed to load API analytics');
  }
};

export const webhookAnalyticsHandler = async (req: Request, res: Response) => {
  try {
    res.json(await getWebhookAnalytics(getUserId(req)));
  } catch (err) {
    handleError(err, res, 'Failed to load webhook analytics');
  }
};

export const chartHandler = async (req: Request, res: Response) => {
  try {
    const metric = req.query.metric;
    if (!isValidMetric(metric)) {
      res.status(400).json({ error: `Invalid chart metric: ${metric}` });
      return;
    }
    const granularity: ChartGranularity = req.query.granularity === 'weekly' || req.query.granularity === 'monthly' ? req.query.granularity : 'daily';
    const filters = parseAnalyticsFilters(req.query);
    res.json(await getChartData(getUserId(req), metric, granularity, filters));
  } catch (err) {
    handleError(err, res, 'Failed to load chart data');
  }
};

export const exportHandler = async (req: Request, res: Response) => {
  try {
    const dataset = req.query.dataset;
    const format = req.query.format;
    const scope = (req.query.scope as string) || 'filtered';
    if (!EXPORT_DATASETS.includes(dataset as ExportDataset)) {
      res.status(400).json({ error: `Invalid export dataset: ${dataset}` });
      return;
    }
    if (!EXPORT_FORMATS.includes(format as ExportFormat)) {
      res.status(400).json({ error: `Invalid export format: ${format}` });
      return;
    }
    if (!EXPORT_SCOPES.includes(scope as ExportScope)) {
      res.status(400).json({ error: `Invalid export scope: ${scope}` });
      return;
    }
    const filters = parseAnalyticsFilters(req.query);
    const table = await buildExportTable(getUserId(req), {
      dataset: dataset as ExportDataset,
      scope: scope as ExportScope,
      filters,
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 25,
    });
    const { buffer, contentType, extension } = await renderExport(table, format as ExportFormat);
    const filename = `${(dataset as string).toLowerCase()}-analytics.${extension}`;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    handleError(err, res, 'Failed to generate export');
  }
};

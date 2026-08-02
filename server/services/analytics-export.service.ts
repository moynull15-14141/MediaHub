import * as XLSX from 'xlsx';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { AnalyticsFilters } from './analytics-filters';
import { listCampaignAnalytics } from './analytics-campaigns.service';
import { getOverview } from './analytics-overview.service';
import { getContactAnalytics } from './analytics-contacts.service';
import { getTemplateAnalytics } from './analytics-templates.service';
import { getQueueAnalytics } from './analytics-queue.service';
import { getApiAnalytics } from './analytics-api.service';
import { getWebhookAnalytics } from './analytics-webhook.service';

export class ExportError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export const EXPORT_DATASETS = ['OVERVIEW', 'CAMPAIGNS', 'CONTACTS', 'TEMPLATES', 'QUEUE', 'API', 'WEBHOOK'] as const;
export type ExportDataset = (typeof EXPORT_DATASETS)[number];
export const EXPORT_FORMATS = ['CSV', 'XLSX', 'PDF'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const EXPORT_SCOPES = ['page', 'filtered', 'all'] as const;
export type ExportScope = (typeof EXPORT_SCOPES)[number];

export interface ExportTable {
  title: string;
  headers: string[];
  rows: (string | number)[][];
}

const formatValue = (v: unknown): string | number => {
  if (v === null || v === undefined) return '—';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) {
    return v
      .map((item) => {
        if (item && typeof item === 'object') {
          const name = (item as any).name ?? (item as any).status ?? (item as any).period ?? (item as any).date;
          const count = (item as any).contactCount ?? (item as any).count ?? (item as any).usageCount ?? (item as any).value;
          return name !== undefined && count !== undefined ? `${name}: ${count}` : JSON.stringify(item);
        }
        return String(item);
      })
      .join('; ');
  }
  return JSON.stringify(v);
};

// Flat "Metric, Value" export for the aggregate-analytics tabs (Overview,
// Contacts, Templates, Queue, API, Webhook) - these don't have a natural
// per-row shape, so a key/value table is the honest representation rather
// than forcing them into fake rows.
const summaryTable = (title: string, obj: Record<string, unknown>): ExportTable => ({
  title,
  headers: ['Metric', 'Value'],
  rows: Object.entries(obj).map(([key, value]) => [key, formatValue(value)]),
});

const campaignsTable = (campaigns: Awaited<ReturnType<typeof listCampaignAnalytics>>['campaigns']): ExportTable => ({
  title: 'Campaign Analytics',
  headers: ['Name', 'Status', 'Recipients', 'Delivered', 'Read', 'Failed', 'Skipped', 'Retries', 'Start Time', 'Finish Time', 'Avg Send Speed (msg/min)'],
  rows: campaigns.map((c) => [
    c.name,
    c.sendStatus,
    c.recipients,
    c.delivered,
    c.read,
    c.failed,
    c.skipped,
    c.retryCount,
    c.startTime ? new Date(c.startTime).toISOString() : '—',
    c.finishTime ? new Date(c.finishTime).toISOString() : '—',
    c.avgSendSpeedPerMinute ?? '—',
  ]),
});

export interface BuildExportOptions {
  dataset: ExportDataset;
  scope: ExportScope;
  filters: AnalyticsFilters;
  page?: number;
  pageSize?: number;
}

// Every export reuses the exact same analytics service function the
// corresponding dashboard tab calls - an export can never show numbers that
// disagree with what's on screen, because it's the same query.
export const buildExportTable = async (userId: string, options: BuildExportOptions): Promise<ExportTable> => {
  const scopedFilters: AnalyticsFilters = options.scope === 'all' ? {} : options.filters;
  const listOptions =
    options.scope === 'page'
      ? { ...scopedFilters, page: options.page, pageSize: options.pageSize }
      : { ...scopedFilters, page: 1, pageSize: 5000 };

  switch (options.dataset) {
    case 'OVERVIEW':
      return summaryTable('Overview', await getOverview(userId, scopedFilters));
    case 'CAMPAIGNS': {
      const { campaigns } = await listCampaignAnalytics(userId, listOptions);
      return campaignsTable(campaigns);
    }
    case 'CONTACTS':
      return summaryTable('Contact Analytics', await getContactAnalytics(userId, scopedFilters.dateFrom, scopedFilters.dateTo));
    case 'TEMPLATES': {
      const data = await getTemplateAnalytics(userId);
      return {
        title: 'Template Analytics',
        headers: ['Name', 'Category', 'Favorite', 'Usage', 'Success %', 'Read %', 'Failure %'],
        rows: data.templates.map((t) => [t.name, t.category, t.isFavorite ? 'Yes' : 'No', t.usageCount, t.successPercent, t.readPercent, t.failurePercent]),
      };
    }
    case 'QUEUE':
      return summaryTable('Queue Analytics', await getQueueAnalytics(userId, scopedFilters.campaignId));
    case 'API':
      return summaryTable('API Analytics', await getApiAnalytics(userId, scopedFilters.dateFrom, scopedFilters.dateTo));
    case 'WEBHOOK':
      return summaryTable('Webhook Analytics', await getWebhookAnalytics(userId));
    default:
      throw new ExportError(`Unknown export dataset: ${options.dataset}`);
  }
};

const csvEscape = (v: string | number): string => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const renderCsv = (table: ExportTable): Buffer => {
  const lines = [table.headers.map(csvEscape).join(','), ...table.rows.map((r) => r.map(csvEscape).join(','))];
  return Buffer.from(lines.join('\n'), 'utf8');
};

export const renderXlsx = (table: ExportTable): Buffer => {
  const sheet = XLSX.utils.aoa_to_sheet([table.headers, ...table.rows]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, table.title.slice(0, 31) || 'Report');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

export const renderPdf = async (table: ExportTable): Promise<Buffer> => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 792; // landscape US Letter
  const pageHeight = 612;
  const margin = 36;
  const rowHeight = 16;
  const fontSize = 9;

  const colWidths = table.headers.map((h, i) => {
    const maxLen = Math.max(h.length, ...table.rows.map((r) => String(r[i] ?? '').length));
    return Math.min(220, Math.max(60, maxLen * 5.5));
  });

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const drawHeader = () => {
    page.drawText(table.title, { x: margin, y, size: 14, font: boldFont, color: rgb(0.1, 0.1, 0.1) });
    y -= 24;
    let x = margin;
    table.headers.forEach((h, i) => {
      page.drawText(h.slice(0, 40), { x, y, size: fontSize, font: boldFont, color: rgb(0.1, 0.1, 0.1) });
      x += colWidths[i];
    });
    y -= rowHeight;
  };

  drawHeader();

  for (const row of table.rows) {
    if (y < margin + rowHeight) {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
      drawHeader();
    }
    let x = margin;
    row.forEach((cell, i) => {
      page.drawText(String(cell ?? '').slice(0, 60), { x, y, size: fontSize, font, color: rgb(0.2, 0.2, 0.2) });
      x += colWidths[i];
    });
    y -= rowHeight;
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
};

export const renderExport = async (table: ExportTable, format: ExportFormat): Promise<{ buffer: Buffer; contentType: string; extension: string }> => {
  if (format === 'CSV') return { buffer: renderCsv(table), contentType: 'text/csv', extension: 'csv' };
  if (format === 'XLSX') return { buffer: renderXlsx(table), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' };
  return { buffer: await renderPdf(table), contentType: 'application/pdf', extension: 'pdf' };
};

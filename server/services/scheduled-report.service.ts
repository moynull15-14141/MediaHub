import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { uploadBufferToR2, getPresignedDownloadUrl, deleteFromR2 } from '../lib/r2';
import { findUserById } from './user.service';
import { sanitizeText } from './contact.service';
import { EXPORT_DATASETS, EXPORT_FORMATS, ExportDataset, ExportFormat, buildExportTable, renderExport } from './analytics-export.service';
import { AnalyticsFilters } from './analytics-filters';
import { logAudit } from './whatsapp-audit.service';

export class ReportError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
const NAME_MAX = 150;

const computeNextRunAt = (frequency: (typeof FREQUENCIES)[number], from: Date): Date => {
  const next = new Date(from);
  if (frequency === 'DAILY') next.setDate(next.getDate() + 1);
  else if (frequency === 'WEEKLY') next.setDate(next.getDate() + 7);
  else next.setMonth(next.getMonth() + 1);
  return next;
};

const toPublicScheduledReport = (report: any) => ({
  id: report.id,
  name: report.name,
  frequency: report.frequency,
  dataset: report.dataset,
  format: report.format,
  filters: report.filters ?? {},
  enabled: report.enabled,
  lastRunAt: report.lastRunAt,
  nextRunAt: report.nextRunAt,
  createdAt: report.createdAt,
  updatedAt: report.updatedAt,
});

const validateScheduleInput = (body: any) => {
  const name = sanitizeText(body?.name, NAME_MAX);
  if (!name) throw new ReportError('Report name is required', 400);
  if (!FREQUENCIES.includes(body?.frequency)) throw new ReportError(`Invalid frequency: ${body?.frequency}`, 400);
  if (!EXPORT_DATASETS.includes(body?.dataset)) throw new ReportError(`Invalid dataset: ${body?.dataset}`, 400);
  if (!EXPORT_FORMATS.includes(body?.format)) throw new ReportError(`Invalid format: ${body?.format}`, 400);
  const filters = body?.filters && typeof body.filters === 'object' ? body.filters : {};
  return {
    name,
    frequency: body.frequency as (typeof FREQUENCIES)[number],
    dataset: body.dataset as ExportDataset,
    format: body.format as ExportFormat,
    filters,
    enabled: body?.enabled === undefined ? true : Boolean(body.enabled),
  };
};

export const listScheduledReports = async (workspaceId: string) => {
  const reports = await prisma.scheduledReport.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' } });
  return reports.map(toPublicScheduledReport);
};

export const createScheduledReport = async (workspaceId: string, userId: string, body: any) => {
  const input = validateScheduleInput(body);
  const report = await prisma.scheduledReport.create({
    data: { workspaceId, userId, ...input, nextRunAt: computeNextRunAt(input.frequency, new Date()) },
  });
  await logAudit(userId, 'SCHEDULED_REPORT_CREATED', report.name);
  return toPublicScheduledReport(report);
};

export const updateScheduledReport = async (workspaceId: string, id: string, body: any) => {
  const existing = await prisma.scheduledReport.findUnique({ where: { id } });
  if (!existing || existing.workspaceId !== workspaceId) throw new ReportError('Scheduled report not found', 404);
  const input = validateScheduleInput({ ...existing, ...body });
  const frequencyChanged = input.frequency !== existing.frequency;
  const report = await prisma.scheduledReport.update({
    where: { id },
    data: { ...input, nextRunAt: frequencyChanged ? computeNextRunAt(input.frequency, new Date()) : existing.nextRunAt },
  });
  return toPublicScheduledReport(report);
};

export const deleteScheduledReport = async (workspaceId: string, id: string) => {
  const existing = await prisma.scheduledReport.findUnique({ where: { id } });
  if (!existing || existing.workspaceId !== workspaceId) throw new ReportError('Scheduled report not found', 404);
  await prisma.scheduledReport.delete({ where: { id } });
};

const reportStorageKey = (userId: string, id: string, extension: string) => `whatsapp-analytics-reports/${userId}/${id}.${extension}`;

// The single generation path used both by "Generate now" (manual, from the
// Reports tab) and the scheduler's tick loop below - a scheduled report and
// an on-demand export of the same dataset/filters produce byte-identical
// output because they call the exact same functions. Analytics data itself
// (buildExportTable) is still computed per-userId (not yet workspace-scoped
// in this pass); only the ReportHistory record this produces is
// workspace-scoped, matching Contacts/Campaigns/Templates/Groups/Labels.
export const generateReport = async (
  workspaceId: string,
  userId: string,
  options: { name: string; dataset: ExportDataset; format: ExportFormat; filters: AnalyticsFilters; scheduledReportId?: string },
) => {
  const table = await buildExportTable(userId, { dataset: options.dataset, scope: 'filtered', filters: options.filters });
  const { buffer, contentType, extension } = await renderExport(table, options.format);

  const id = crypto.randomUUID();
  const storageKey = reportStorageKey(userId, id, extension);
  await uploadBufferToR2(buffer, storageKey, contentType);

  const generatedBy = (await findUserById(userId))?.email ?? 'system';
  const history = await prisma.reportHistory.create({
    data: {
      id,
      workspaceId,
      userId,
      scheduledReportId: options.scheduledReportId,
      name: options.name,
      dataset: options.dataset,
      format: options.format,
      filters: options.filters as any,
      fileSizeBytes: buffer.byteLength,
      storageKey,
      generatedBy,
    },
  });
  await logAudit(userId, 'REPORT_GENERATED', `${options.dataset} (${options.format})`);
  return history;
};

export const listReportHistory = async (workspaceId: string, page: number, pageSize: number) => {
  const [entries, total] = await Promise.all([
    prisma.reportHistory.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.reportHistory.count({ where: { workspaceId } }),
  ]);
  return {
    entries: entries.map((e) => ({
      id: e.id,
      name: e.name,
      dataset: e.dataset,
      format: e.format,
      filters: e.filters ?? {},
      fileSizeBytes: e.fileSizeBytes,
      generatedBy: e.generatedBy,
      createdAt: e.createdAt,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
};

export const getReportDownloadUrl = async (workspaceId: string, id: string): Promise<{ url: string; filename: string }> => {
  const entry = await prisma.reportHistory.findUnique({ where: { id } });
  if (!entry || entry.workspaceId !== workspaceId) throw new ReportError('Report not found', 404);
  const extension = entry.format.toLowerCase();
  const filename = `${entry.name.replace(/[^a-z0-9-_]+/gi, '-')}.${extension}`;
  const url = await getPresignedDownloadUrl(entry.storageKey, filename);
  return { url, filename };
};

export const deleteReportHistory = async (workspaceId: string, id: string) => {
  const entry = await prisma.reportHistory.findUnique({ where: { id } });
  if (!entry || entry.workspaceId !== workspaceId) throw new ReportError('Report not found', 404);
  await deleteFromR2([entry.storageKey]);
  await prisma.reportHistory.delete({ where: { id } });
};

export { computeNextRunAt };

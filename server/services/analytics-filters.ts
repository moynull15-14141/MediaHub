// Shared filter parsing for the entire Analytics & Reporting module (Phase 6).
// Every analytics endpoint accepts the same query shape (date range, campaign,
// template, status, group, label, search) so filters behave identically across
// Overview / Campaigns / Templates / Charts / Export instead of each endpoint
// reinventing its own subset.
export interface AnalyticsFilters {
  dateFrom?: Date;
  dateTo?: Date;
  campaignId?: string;
  templateId?: string;
  status?: string;
  groupId?: string;
  labelId?: string;
  search?: string;
}

const CAMPAIGN_SEND_STATUSES = ['NOT_STARTED', 'SCHEDULED', 'QUEUED', 'SENDING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED'];

export class AnalyticsFilterError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export const parseAnalyticsFilters = (query: any): AnalyticsFilters => {
  const filters: AnalyticsFilters = {};

  if (query?.dateFrom) {
    const d = new Date(String(query.dateFrom));
    if (Number.isNaN(d.getTime())) throw new AnalyticsFilterError('Invalid dateFrom');
    filters.dateFrom = d;
  }
  if (query?.dateTo) {
    const d = new Date(String(query.dateTo));
    if (Number.isNaN(d.getTime())) throw new AnalyticsFilterError('Invalid dateTo');
    d.setHours(23, 59, 59, 999);
    filters.dateTo = d;
  }
  if (query?.campaignId) filters.campaignId = String(query.campaignId);
  if (query?.templateId) filters.templateId = String(query.templateId);
  if (query?.status) {
    const status = String(query.status);
    if (!CAMPAIGN_SEND_STATUSES.includes(status)) throw new AnalyticsFilterError(`Invalid status: ${status}`);
    filters.status = status;
  }
  if (query?.groupId) filters.groupId = String(query.groupId);
  if (query?.labelId) filters.labelId = String(query.labelId);
  if (query?.search) filters.search = String(query.search).trim();

  return filters;
};

// Produces a Campaign where-clause; reused directly and via the `campaign: {}`
// relation filter on CampaignQueueJob/CampaignSendLog so every analytics
// query - no matter which table it aggregates - respects the same filters.
export const buildCampaignWhere = (userId: string, filters: AnalyticsFilters): any => {
  const where: any = { userId };
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    };
  }
  if (filters.campaignId) where.id = filters.campaignId;
  if (filters.templateId) where.templateId = filters.templateId;
  if (filters.status) where.sendStatus = filters.status;
  if (filters.search) where.name = { contains: filters.search, mode: 'insensitive' };
  if (filters.groupId || filters.labelId) {
    where.recipients = {
      some: {
        contact: {
          ...(filters.groupId ? { groups: { some: { groupId: filters.groupId } } } : {}),
          ...(filters.labelId ? { labels: { some: { labelId: filters.labelId } } } : {}),
        },
      },
    };
  }
  return where;
};

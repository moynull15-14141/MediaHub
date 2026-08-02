import { Router } from 'express';
import { requireAuth } from '../lib/require-auth';
import {
  connectHandler,
  getAccountHandler,
  disconnectHandler,
  refreshHandler,
  updateSettingsHandler,
  rotateTokenHandler,
  securityInfoHandler,
  webhookMonitorHandler,
  apiHealthHandler,
  systemHealthHandler,
  auditLogsHandler,
  logoUploadMiddleware,
  handleLogoUploadError,
  logoUploadHandler,
  logoRemoveHandler,
  defaultAttachmentUploadMiddleware,
  handleDefaultAttachmentUploadError,
  defaultAttachmentUploadHandler,
  defaultAttachmentRemoveHandler,
} from '../controllers/whatsapp-account.controller';
import { dashboardHandler } from '../controllers/whatsapp-dashboard.controller';
import {
  listHandler as listContactsHandler,
  createHandler as createContactHandler,
  updateHandler as updateContactHandler,
  deleteHandler as deleteContactHandler,
  bulkDeleteHandler as bulkDeleteContactsHandler,
} from '../controllers/contact.controller';
import {
  importUploadMiddleware,
  handleImportUploadError,
  previewHandler,
  commitHandler,
} from '../controllers/contact-import.controller';
import {
  listHandler as listGroupsHandler,
  createHandler as createGroupHandler,
  renameHandler as renameGroupHandler,
  deleteHandler as deleteGroupHandler,
  assignContactsHandler,
  removeContactsHandler,
} from '../controllers/group.controller';
import {
  listHandler as listLabelsHandler,
  createHandler as createLabelHandler,
  renameHandler as renameLabelHandler,
  deleteHandler as deleteLabelHandler,
  assignToContactHandler,
} from '../controllers/label.controller';
import {
  listHandler as listCampaignsHandler,
  getHandler as getCampaignHandler,
  createHandler as createCampaignHandler,
  updateHandler as updateCampaignHandler,
  deleteHandler as deleteCampaignHandler,
  duplicateHandler as duplicateCampaignHandler,
  updateStatusHandler as updateCampaignStatusHandler,
  validateCampaignIdParam,
  attachmentUploadMiddleware,
  handleAttachmentUploadError,
  attachmentUploadHandler,
  attachmentRemoveHandler,
  applyDefaultAttachmentHandler,
} from '../controllers/campaign.controller';
import {
  listHandler as listTemplatesHandler,
  createHandler as createTemplateHandler,
  updateHandler as updateTemplateHandler,
  deleteHandler as deleteTemplateHandler,
  duplicateHandler as duplicateTemplateHandler,
  favoriteHandler as favoriteTemplateHandler,
  variablesHandler as templateVariablesHandler,
  previewHandler as templatePreviewHandler,
} from '../controllers/message-template.controller';
import {
  sendNowHandler,
  scheduleHandler,
  pauseHandler,
  resumeHandler,
  cancelHandler,
  progressHandler,
  logsHandler,
  eventsHandler,
} from '../controllers/campaign-queue.controller';
import {
  listHandler as listBlacklistHandler,
  createHandler as createBlacklistHandler,
  deleteHandler as deleteBlacklistHandler,
  bulkDeleteHandler as bulkDeleteBlacklistHandler,
  importUploadMiddleware as blacklistImportUploadMiddleware,
  handleImportUploadError as handleBlacklistImportUploadError,
  importHandler as importBlacklistHandler,
  exportHandler as exportBlacklistHandler,
} from '../controllers/whatsapp-blacklist.controller';
import {
  overviewHandler,
  campaignsListHandler,
  campaignDetailHandler,
  contactsHandler as analyticsContactsHandler,
  templatesHandler as analyticsTemplatesHandler,
  queueHandler as analyticsQueueHandler,
  apiAnalyticsHandler,
  webhookAnalyticsHandler,
  chartHandler,
  exportHandler as analyticsExportHandler,
} from '../controllers/analytics.controller';
import {
  listScheduledHandler,
  createScheduledHandler,
  updateScheduledHandler,
  deleteScheduledHandler,
  generateNowHandler,
  listHistoryHandler,
  downloadHistoryHandler,
  deleteHistoryHandler,
} from '../controllers/report.controller';

const router = Router();

// EventSource can't set an Authorization header, so this route accepts the
// JWT as a query param instead and does its own auth check internally - it
// must be registered before the router-wide requireAuth below, or that
// middleware would reject it first for lacking a header.
router.get('/campaigns/:id/events', validateCampaignIdParam, eventsHandler);

// WhatsApp Campaign manages a real business account and contact data, so
// every other route in this module requires a logged-in user (no anonymous
// access).
router.use(requireAuth);

router.post('/account/connect', connectHandler);
router.get('/account', getAccountHandler);
router.post('/account/disconnect', disconnectHandler);
router.post('/account/refresh', refreshHandler);
router.patch('/account/settings', updateSettingsHandler);
router.post('/account/rotate-token', rotateTokenHandler);
router.get('/account/security', securityInfoHandler);
router.get('/account/webhook-monitor', webhookMonitorHandler);
router.get('/account/api-health', apiHealthHandler);
router.get('/account/system-health', systemHealthHandler);
router.get('/account/audit-logs', auditLogsHandler);
router.post('/account/logo', logoUploadMiddleware, handleLogoUploadError, logoUploadHandler);
router.delete('/account/logo', logoRemoveHandler);
router.post(
  '/account/default-attachment',
  defaultAttachmentUploadMiddleware,
  handleDefaultAttachmentUploadError,
  defaultAttachmentUploadHandler,
);
router.delete('/account/default-attachment', defaultAttachmentRemoveHandler);

router.get('/dashboard', dashboardHandler);

router.get('/contacts', listContactsHandler);
router.post('/contacts', createContactHandler);
router.put('/contacts/:id', updateContactHandler);
router.delete('/contacts/:id', deleteContactHandler);
router.post('/contacts/bulk-delete', bulkDeleteContactsHandler);
router.post('/contacts/:id/labels', assignToContactHandler);

router.post('/contacts/import/preview', importUploadMiddleware, handleImportUploadError, previewHandler);
router.post('/contacts/import/commit', commitHandler);

router.get('/groups', listGroupsHandler);
router.post('/groups', createGroupHandler);
router.put('/groups/:id', renameGroupHandler);
router.delete('/groups/:id', deleteGroupHandler);
router.post('/groups/:id/contacts', assignContactsHandler);
router.delete('/groups/:id/contacts', removeContactsHandler);

router.get('/labels', listLabelsHandler);
router.post('/labels', createLabelHandler);
router.put('/labels/:id', renameLabelHandler);
router.delete('/labels/:id', deleteLabelHandler);

router.get('/campaigns', listCampaignsHandler);
router.post('/campaigns', createCampaignHandler);
router.get('/campaigns/:id', validateCampaignIdParam, getCampaignHandler);
router.put('/campaigns/:id', validateCampaignIdParam, updateCampaignHandler);
router.delete('/campaigns/:id', validateCampaignIdParam, deleteCampaignHandler);
router.post('/campaigns/:id/duplicate', validateCampaignIdParam, duplicateCampaignHandler);
router.patch('/campaigns/:id/status', validateCampaignIdParam, updateCampaignStatusHandler);
router.post(
  '/campaigns/:id/attachment',
  validateCampaignIdParam,
  attachmentUploadMiddleware,
  handleAttachmentUploadError,
  attachmentUploadHandler,
);
router.delete('/campaigns/:id/attachment', validateCampaignIdParam, attachmentRemoveHandler);
router.post('/campaigns/:id/attachment/apply-default', validateCampaignIdParam, applyDefaultAttachmentHandler);

router.post('/campaigns/:id/send', validateCampaignIdParam, sendNowHandler);
router.post('/campaigns/:id/schedule', validateCampaignIdParam, scheduleHandler);
router.post('/campaigns/:id/pause', validateCampaignIdParam, pauseHandler);
router.post('/campaigns/:id/resume', validateCampaignIdParam, resumeHandler);
router.post('/campaigns/:id/queue/cancel', validateCampaignIdParam, cancelHandler);
router.get('/campaigns/:id/progress', validateCampaignIdParam, progressHandler);
router.get('/campaigns/:id/logs', validateCampaignIdParam, logsHandler);

router.get('/templates/variables', templateVariablesHandler);
router.post('/templates/preview', templatePreviewHandler);
router.get('/templates', listTemplatesHandler);
router.post('/templates', createTemplateHandler);
router.put('/templates/:id', updateTemplateHandler);
router.delete('/templates/:id', deleteTemplateHandler);
router.post('/templates/:id/duplicate', duplicateTemplateHandler);
router.patch('/templates/:id/favorite', favoriteTemplateHandler);

router.get('/blacklist', listBlacklistHandler);
router.post('/blacklist', createBlacklistHandler);
router.delete('/blacklist/:id', deleteBlacklistHandler);
router.post('/blacklist/bulk-delete', bulkDeleteBlacklistHandler);
router.post('/blacklist/import', blacklistImportUploadMiddleware, handleBlacklistImportUploadError, importBlacklistHandler);
router.get('/blacklist/export', exportBlacklistHandler);

router.get('/analytics/overview', overviewHandler);
router.get('/analytics/campaigns', campaignsListHandler);
router.get('/analytics/campaigns/:id', validateCampaignIdParam, campaignDetailHandler);
router.get('/analytics/contacts', analyticsContactsHandler);
router.get('/analytics/templates', analyticsTemplatesHandler);
router.get('/analytics/queue', analyticsQueueHandler);
router.get('/analytics/api', apiAnalyticsHandler);
router.get('/analytics/webhook', webhookAnalyticsHandler);
router.get('/analytics/chart', chartHandler);
router.get('/analytics/export', analyticsExportHandler);

router.get('/analytics/scheduled-reports', listScheduledHandler);
router.post('/analytics/scheduled-reports', createScheduledHandler);
router.put('/analytics/scheduled-reports/:id', updateScheduledHandler);
router.delete('/analytics/scheduled-reports/:id', deleteScheduledHandler);
router.post('/analytics/reports/generate', generateNowHandler);
router.get('/analytics/reports/history', listHistoryHandler);
router.get('/analytics/reports/history/:id/download', downloadHistoryHandler);
router.delete('/analytics/reports/history/:id', deleteHistoryHandler);

export default router;

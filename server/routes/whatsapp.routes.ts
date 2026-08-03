import { Router } from 'express';
import { requireAuth } from '../lib/require-auth';
import { resolveWorkspace, requirePermission, requireWorkspaceRole } from '../lib/require-workspace';
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
  setDefaultAccountHandler,
  setSendingEnabledHandler,
  setPriorityHandler,
  tokenStatusHandler,
  resumeAccountHandler,
  healthHistoryHandler,
} from '../controllers/whatsapp-account.controller';
import { dashboardHandler } from '../controllers/whatsapp-dashboard.controller';
import {
  webhookStatusHandler,
  webhookEventsHandler,
  webhookDeadLettersHandler,
  webhookReplayHandler,
  webhookVerifyNowHandler,
  webhookReRegisterHandler,
} from '../controllers/webhook-automation.controller';
import {
  accountOperationsHandler,
  accountLimitsHandler,
  accountRoutingHandler,
  accountQualityHandler,
  dashboardOperationsHandler,
  accountFailoverHandler,
  accountRebalanceHandler,
  accountResetDailyLimitHandler,
} from '../controllers/operations.controller';
import {
  metaConfigHandler,
  metaCallbackHandler,
  metaSyncHandler,
  metaValidateHandler,
  listWorkspaceAccountsHandler,
} from '../controllers/meta-connect.controller';
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
import {
  myPermissionsHandler,
  listMembersHandler,
  inviteMemberHandler,
  removeMemberHandler,
  suspendMemberHandler,
  reactivateMemberHandler,
  changeMemberRoleHandler,
  transferOwnershipHandler,
} from '../controllers/workspace-team.controller';

const router = Router();

// EventSource can't set an Authorization header, so this route accepts the
// JWT as a query param instead and does its own auth + permission check
// internally - it must be registered before the router-wide requireAuth
// below, or that middleware would reject it first for lacking a header.
router.get('/campaigns/:id/events', validateCampaignIdParam, eventsHandler);

// WhatsApp Campaign manages a real business account and contact data, so
// every other route in this module requires a logged-in user (no anonymous
// access). resolveWorkspace runs right after - every handler below can rely
// on req.workspaceId/req.workspace/req.workspaceMember being populated from
// the authenticated user's own membership, never from a client-supplied id.
// requirePermission (Phase A.3) then gates each route by the resolved
// member's effective permission set (role defaults + any per-user override).
router.use(requireAuth);
router.use(resolveWorkspace);

router.post('/account/connect', requirePermission('settings:write'), connectHandler);
router.get('/account', requirePermission('settings:read'), getAccountHandler);
router.post('/account/disconnect', requirePermission('settings:write'), disconnectHandler);
router.post('/account/refresh', requirePermission('settings:write'), refreshHandler);
router.patch('/account/settings', requirePermission('settings:write'), updateSettingsHandler);
router.post('/account/rotate-token', requirePermission('settings:write'), rotateTokenHandler);
router.get('/account/security', requirePermission('settings:read'), securityInfoHandler);
router.get('/account/webhook-monitor', requirePermission('settings:read'), webhookMonitorHandler);
router.get('/account/api-health', requirePermission('settings:read'), apiHealthHandler);
router.get('/account/system-health', requirePermission('settings:read'), systemHealthHandler);
router.get('/account/audit-logs', requirePermission('settings:read'), auditLogsHandler);

// Phase B.3 - Token Lifecycle Automation. Self-service (caller's own
// account), same settings:read/settings:write gating as every other
// self-service route above. POST /account/validate and POST /account/reconnect
// are intentionally NOT duplicated here - they already exist as
// /account/meta/validate and /account/meta/callback respectively.
router.get('/account/token-status', requirePermission('settings:read'), tokenStatusHandler);
router.post('/account/resume', requirePermission('settings:write'), resumeAccountHandler);
router.get('/account/health-history', requirePermission('settings:read'), healthHistoryHandler);

// Phase B.4 - Webhook Automation & Delivery Reliability. Self-service (the
// caller's own account), same settings:read/settings:write gating as every
// other self-service route above. Distinct from the pre-existing, unauthenticated
// /api/whatsapp/webhook GET+POST (Meta's own handshake/delivery callbacks,
// registered directly on the Express app in server.ts) - these are the
// authenticated dashboard-facing endpoints for status/history/replay/re-verify.
router.get('/account/webhook/status', requirePermission('settings:read'), webhookStatusHandler);
router.get('/account/webhook/events', requirePermission('settings:read'), webhookEventsHandler);
router.get('/account/webhook/dead-letters', requirePermission('settings:read'), webhookDeadLettersHandler);
router.post('/account/webhook/replay', requirePermission('settings:write'), webhookReplayHandler);
router.post('/account/webhook/verify', requirePermission('settings:read'), webhookVerifyNowHandler);
router.post('/account/webhook/re-register', requirePermission('settings:write'), webhookReRegisterHandler);

// Phase B.5 - Production Operations & Multi-Tenant Reliability. Self-service
// reads (settings:read) and self-service actions (settings:write), same
// convention as every route above; /dashboard/operations mirrors the
// existing /dashboard route's analytics:read gate.
router.get('/account/operations', requirePermission('settings:read'), accountOperationsHandler);
router.get('/account/limits', requirePermission('settings:read'), accountLimitsHandler);
router.get('/account/routing', requirePermission('settings:read'), accountRoutingHandler);
router.get('/account/quality', requirePermission('settings:read'), accountQualityHandler);
router.post('/account/failover', requirePermission('settings:write'), accountFailoverHandler);
router.post('/account/rebalance', requirePermission('settings:write'), accountRebalanceHandler);
router.post('/account/reset-daily-limit', requirePermission('settings:write'), accountResetDailyLimitHandler);
router.get('/dashboard/operations', requirePermission('analytics:read'), dashboardOperationsHandler);
router.post('/account/logo', requirePermission('settings:write'), logoUploadMiddleware, handleLogoUploadError, logoUploadHandler);
router.delete('/account/logo', requirePermission('settings:write'), logoRemoveHandler);
router.post(
  '/account/default-attachment',
  requirePermission('settings:write'),
  defaultAttachmentUploadMiddleware,
  handleDefaultAttachmentUploadError,
  defaultAttachmentUploadHandler,
);
router.delete('/account/default-attachment', requirePermission('settings:write'), defaultAttachmentRemoveHandler);

// Phase B.1 - Meta Embedded Signup. Same settings:read/settings:write gates
// as the manual connect endpoints above, since this replaces (not bypasses)
// that permission boundary.
router.get('/account/meta/config', requirePermission('settings:read'), metaConfigHandler);
router.post('/account/meta/callback', requirePermission('settings:write'), metaCallbackHandler);
router.post('/account/meta/sync', requirePermission('settings:write'), metaSyncHandler);
router.post('/account/meta/validate', requirePermission('settings:read'), metaValidateHandler);
router.get('/account/meta/workspace-accounts', requirePermission('settings:read'), listWorkspaceAccountsHandler);

// Phase B.2 - workspace-wide account management. Distinct from every route
// above (which always act on the CALLER's own account via settings:*) -
// these act on ANY account in the workspace by id, so they're gated by
// requireWorkspaceRole('ADMIN') (Owner/Admin manage accounts, per the brief),
// the same mechanism already used for the analogous /members/* routes below.
router.patch('/account/:accountId/default', requireWorkspaceRole('ADMIN'), setDefaultAccountHandler);
router.patch('/account/:accountId/sending', requireWorkspaceRole('ADMIN'), setSendingEnabledHandler);
router.patch('/account/:accountId/priority', requireWorkspaceRole('ADMIN'), setPriorityHandler);

// Campaign-scoped read of the workspace's account list, gated by
// campaigns:write rather than settings:read - Operators/Managers can build a
// campaign and choose a sending account without needing broader account
// settings access. Same handler/data as the existing route above.
router.get('/campaigns/sending-accounts', requirePermission('campaigns:write'), listWorkspaceAccountsHandler);

router.get('/dashboard', requirePermission('analytics:read'), dashboardHandler);

router.get('/contacts', requirePermission('contacts:read'), listContactsHandler);
router.post('/contacts', requirePermission('contacts:write'), createContactHandler);
router.put('/contacts/:id', requirePermission('contacts:write'), updateContactHandler);
router.delete('/contacts/:id', requirePermission('contacts:delete'), deleteContactHandler);
router.post('/contacts/bulk-delete', requirePermission('contacts:delete'), bulkDeleteContactsHandler);
router.post('/contacts/:id/labels', requirePermission('contacts:write'), assignToContactHandler);

router.post('/contacts/import/preview', requirePermission('contacts:write'), importUploadMiddleware, handleImportUploadError, previewHandler);
router.post('/contacts/import/commit', requirePermission('contacts:write'), commitHandler);

router.get('/groups', requirePermission('groups:read'), listGroupsHandler);
router.post('/groups', requirePermission('groups:write'), createGroupHandler);
router.put('/groups/:id', requirePermission('groups:write'), renameGroupHandler);
router.delete('/groups/:id', requirePermission('groups:delete'), deleteGroupHandler);
router.post('/groups/:id/contacts', requirePermission('groups:write'), assignContactsHandler);
router.delete('/groups/:id/contacts', requirePermission('groups:write'), removeContactsHandler);

router.get('/labels', requirePermission('labels:read'), listLabelsHandler);
router.post('/labels', requirePermission('labels:write'), createLabelHandler);
router.put('/labels/:id', requirePermission('labels:write'), renameLabelHandler);
router.delete('/labels/:id', requirePermission('labels:delete'), deleteLabelHandler);

router.get('/campaigns', requirePermission('campaigns:read'), listCampaignsHandler);
router.post('/campaigns', requirePermission('campaigns:write'), createCampaignHandler);
router.get('/campaigns/:id', validateCampaignIdParam, requirePermission('campaigns:read'), getCampaignHandler);
router.put('/campaigns/:id', validateCampaignIdParam, requirePermission('campaigns:write'), updateCampaignHandler);
router.delete('/campaigns/:id', validateCampaignIdParam, requirePermission('campaigns:delete'), deleteCampaignHandler);
router.post('/campaigns/:id/duplicate', validateCampaignIdParam, requirePermission('campaigns:write'), duplicateCampaignHandler);
router.patch('/campaigns/:id/status', validateCampaignIdParam, requirePermission('campaigns:write'), updateCampaignStatusHandler);
router.post(
  '/campaigns/:id/attachment',
  validateCampaignIdParam,
  requirePermission('campaigns:write'),
  attachmentUploadMiddleware,
  handleAttachmentUploadError,
  attachmentUploadHandler,
);
router.delete('/campaigns/:id/attachment', validateCampaignIdParam, requirePermission('campaigns:write'), attachmentRemoveHandler);
router.post('/campaigns/:id/attachment/apply-default', validateCampaignIdParam, requirePermission('campaigns:write'), applyDefaultAttachmentHandler);

router.post('/campaigns/:id/send', validateCampaignIdParam, requirePermission('campaigns:send'), sendNowHandler);
router.post('/campaigns/:id/schedule', validateCampaignIdParam, requirePermission('campaigns:send'), scheduleHandler);
router.post('/campaigns/:id/pause', validateCampaignIdParam, requirePermission('campaigns:send'), pauseHandler);
router.post('/campaigns/:id/resume', validateCampaignIdParam, requirePermission('campaigns:send'), resumeHandler);
router.post('/campaigns/:id/queue/cancel', validateCampaignIdParam, requirePermission('campaigns:send'), cancelHandler);
router.get('/campaigns/:id/progress', validateCampaignIdParam, requirePermission('campaigns:read'), progressHandler);
router.get('/campaigns/:id/logs', validateCampaignIdParam, requirePermission('campaigns:read'), logsHandler);

router.get('/templates/variables', requirePermission('templates:read'), templateVariablesHandler);
router.post('/templates/preview', requirePermission('templates:read'), templatePreviewHandler);
router.get('/templates', requirePermission('templates:read'), listTemplatesHandler);
router.post('/templates', requirePermission('templates:write'), createTemplateHandler);
router.put('/templates/:id', requirePermission('templates:write'), updateTemplateHandler);
router.delete('/templates/:id', requirePermission('templates:delete'), deleteTemplateHandler);
router.post('/templates/:id/duplicate', requirePermission('templates:write'), duplicateTemplateHandler);
router.patch('/templates/:id/favorite', requirePermission('templates:write'), favoriteTemplateHandler);

// Blacklist isn't its own module in the brief's permission matrix - it's
// phone-number-safety data tightly coupled to Contacts, so it's gated under
// the contacts:* permissions rather than inventing a parallel key.
router.get('/blacklist', requirePermission('contacts:read'), listBlacklistHandler);
router.post('/blacklist', requirePermission('contacts:write'), createBlacklistHandler);
router.delete('/blacklist/:id', requirePermission('contacts:delete'), deleteBlacklistHandler);
router.post('/blacklist/bulk-delete', requirePermission('contacts:delete'), bulkDeleteBlacklistHandler);
router.post('/blacklist/import', requirePermission('contacts:write'), blacklistImportUploadMiddleware, handleBlacklistImportUploadError, importBlacklistHandler);
router.get('/blacklist/export', requirePermission('contacts:read'), exportBlacklistHandler);

router.get('/analytics/overview', requirePermission('analytics:read'), overviewHandler);
router.get('/analytics/campaigns', requirePermission('analytics:read'), campaignsListHandler);
router.get('/analytics/campaigns/:id', validateCampaignIdParam, requirePermission('analytics:read'), campaignDetailHandler);
router.get('/analytics/contacts', requirePermission('analytics:read'), analyticsContactsHandler);
router.get('/analytics/templates', requirePermission('analytics:read'), analyticsTemplatesHandler);
router.get('/analytics/queue', requirePermission('analytics:read'), analyticsQueueHandler);
router.get('/analytics/api', requirePermission('analytics:read'), apiAnalyticsHandler);
router.get('/analytics/webhook', requirePermission('analytics:read'), webhookAnalyticsHandler);
router.get('/analytics/chart', requirePermission('analytics:read'), chartHandler);
router.get('/analytics/export', requirePermission('analytics:read'), analyticsExportHandler);

router.get('/analytics/scheduled-reports', requirePermission('reports:read'), listScheduledHandler);
router.post('/analytics/scheduled-reports', requirePermission('reports:write'), createScheduledHandler);
router.put('/analytics/scheduled-reports/:id', requirePermission('reports:write'), updateScheduledHandler);
router.delete('/analytics/scheduled-reports/:id', requirePermission('reports:write'), deleteScheduledHandler);
router.post('/analytics/reports/generate', requirePermission('reports:write'), generateNowHandler);
router.get('/analytics/reports/history', requirePermission('reports:read'), listHistoryHandler);
router.get('/analytics/reports/history/:id/download', requirePermission('reports:read'), downloadHistoryHandler);
router.delete('/analytics/reports/history/:id', requirePermission('reports:write'), deleteHistoryHandler);

// Team management (Part: TEAM MANAGEMENT) - backend only, per the brief.
// requireWorkspaceRole('ADMIN') covers "everyone who can manage members";
// transferOwnershipHandler additionally requires OWNER specifically, since
// an Admin transferring ownership away from the Owner is exactly the kind
// of escalation RBAC exists to prevent.
router.get('/permissions', myPermissionsHandler);
router.get('/members', requirePermission('members:read'), listMembersHandler);
router.post('/members/invite', requirePermission('members:write'), requireWorkspaceRole('ADMIN'), inviteMemberHandler);
router.delete('/members/:userId', requirePermission('members:write'), requireWorkspaceRole('ADMIN'), removeMemberHandler);
router.post('/members/:userId/suspend', requirePermission('members:write'), requireWorkspaceRole('ADMIN'), suspendMemberHandler);
router.post('/members/:userId/reactivate', requirePermission('members:write'), requireWorkspaceRole('ADMIN'), reactivateMemberHandler);
router.patch('/members/:userId/role', requirePermission('members:write'), requireWorkspaceRole('ADMIN'), changeMemberRoleHandler);
router.post('/members/transfer-ownership', requireWorkspaceRole('OWNER'), transferOwnershipHandler);

export default router;

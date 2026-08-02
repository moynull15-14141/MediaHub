import { Request, Response } from 'express';
import { getUserId } from '../lib/require-auth';
import { getWorkspaceId } from '../lib/require-workspace';
import { verifyAuthToken } from '../services/user.service';
import { getCurrentWorkspaceForUser } from '../services/workspace.service';
import { hasPermission } from '../services/permission.service';
import { logAudit } from '../services/whatsapp-audit.service';
import {
  startCampaignNow,
  scheduleCampaign,
  pauseCampaign,
  resumeCampaign,
  cancelQueue,
  getCampaignProgress,
  getCampaignLogs,
  CampaignQueueError,
} from '../services/campaign-queue.service';
import { CampaignError } from '../services/campaign.service';
import { campaignEvents } from '../lib/campaign-events';

const handleQueueError = (err: any, res: Response, fallback: string) => {
  if (err instanceof CampaignQueueError || err instanceof CampaignError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(fallback, err);
  res.status(500).json({ error: fallback });
};

export const sendNowHandler = async (req: Request, res: Response) => {
  try {
    const campaign = await startCampaignNow(getWorkspaceId(req), getUserId(req), req.params.id);
    res.json(campaign);
  } catch (err) {
    handleQueueError(err, res, 'Failed to start sending campaign');
  }
};

export const scheduleHandler = async (req: Request, res: Response) => {
  try {
    const campaign = await scheduleCampaign(getWorkspaceId(req), getUserId(req), req.params.id, req.body);
    res.json(campaign);
  } catch (err) {
    handleQueueError(err, res, 'Failed to schedule campaign');
  }
};

export const pauseHandler = async (req: Request, res: Response) => {
  try {
    const campaign = await pauseCampaign(getWorkspaceId(req), getUserId(req), req.params.id);
    res.json(campaign);
  } catch (err) {
    handleQueueError(err, res, 'Failed to pause campaign');
  }
};

export const resumeHandler = async (req: Request, res: Response) => {
  try {
    const campaign = await resumeCampaign(getWorkspaceId(req), getUserId(req), req.params.id);
    res.json(campaign);
  } catch (err) {
    handleQueueError(err, res, 'Failed to resume campaign');
  }
};

export const cancelHandler = async (req: Request, res: Response) => {
  try {
    const campaign = await cancelQueue(getWorkspaceId(req), getUserId(req), req.params.id);
    res.json(campaign);
  } catch (err) {
    handleQueueError(err, res, 'Failed to cancel campaign');
  }
};

export const progressHandler = async (req: Request, res: Response) => {
  try {
    const progress = await getCampaignProgress(getWorkspaceId(req), req.params.id);
    res.json(progress);
  } catch (err) {
    handleQueueError(err, res, 'Failed to load progress');
  }
};

export const logsHandler = async (req: Request, res: Response) => {
  try {
    const { page, pageSize } = req.query;
    const result = await getCampaignLogs(getWorkspaceId(req), req.params.id, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
    res.json(result);
  } catch (err) {
    handleQueueError(err, res, 'Failed to load logs');
  }
};

// EventSource can't set an Authorization header, so this one endpoint also
// accepts the JWT as a query param, validated with the same verifyAuthToken
// used everywhere else. It's registered before the router-wide requireAuth/
// resolveWorkspace middleware (see whatsapp.routes.ts), so it resolves the
// workspace itself the same way that middleware does.
export const eventsHandler = async (req: Request, res: Response) => {
  const campaignId = req.params.id;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
  const headerToken = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
  const payload = verifyAuthToken(queryToken || headerToken || '');
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  const member = await getCurrentWorkspaceForUser(payload.sub);
  if (!member) {
    res.status(403).json({ error: 'No workspace found for this account' });
    return;
  }
  const workspaceId = member.workspaceId;
  if (!(await hasPermission(workspaceId, payload.sub, member.role, 'campaigns:read'))) {
    void logAudit(payload.sub, 'PERMISSION_DENIED', `campaigns:read on ${req.method} ${req.originalUrl}`);
    res.status(403).json({ error: 'You do not have permission to perform this action' });
    return;
  }

  try {
    const progress = await getCampaignProgress(workspaceId, campaignId);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const send = (data: any) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    send(progress);

    const onProgress = (updatedCampaignId: string) => {
      if (updatedCampaignId !== campaignId) return;
      getCampaignProgress(workspaceId, campaignId)
        .then(send)
        .catch(() => {});
    };
    campaignEvents.on('progress', onProgress);

    const keepAlive = setInterval(() => res.write(': ping\n\n'), 20000);

    req.on('close', () => {
      clearInterval(keepAlive);
      campaignEvents.off('progress', onProgress);
      res.end();
    });
  } catch (err) {
    handleQueueError(err, res, 'Failed to open progress stream');
  }
};

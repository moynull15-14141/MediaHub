import { Request, Response } from 'express';
import { getUserId } from '../lib/require-auth';
import { getWebhookHealth } from '../services/webhook-health.service';
import { listWebhookEvents } from '../services/campaign-webhook.service';
import { listDeadLetters, replayDeadLetter, WebhookDeadLetterError } from '../services/webhook-dead-letter.service';
import { verifyWebhookNow, reRegisterWebhook, WebhookRegistrationError } from '../services/webhook-registration.service';

const handleWebhookError = (err: any, res: Response, fallback: string) => {
  if (err instanceof WebhookDeadLetterError || err instanceof WebhookRegistrationError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(fallback, err);
  res.status(500).json({ error: fallback });
};

// Phase B.4 - Webhook Automation & Delivery Reliability. All self-service
// (caller's own account), gated in whatsapp.routes.ts by the same
// settings:read/settings:write permissions as every other /account/* route.

export const webhookStatusHandler = async (req: Request, res: Response) => {
  try {
    const status = await getWebhookHealth(getUserId(req));
    res.json(status);
  } catch (err) {
    handleWebhookError(err, res, 'Failed to load webhook status');
  }
};

export const webhookEventsHandler = async (req: Request, res: Response) => {
  try {
    const { page, pageSize } = req.query;
    const result = await listWebhookEvents(getUserId(req), {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
    res.json(result);
  } catch (err) {
    handleWebhookError(err, res, 'Failed to load webhook events');
  }
};

export const webhookDeadLettersHandler = async (req: Request, res: Response) => {
  try {
    const { page, pageSize } = req.query;
    const result = await listDeadLetters(getUserId(req), {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
    res.json(result);
  } catch (err) {
    handleWebhookError(err, res, 'Failed to load dead-lettered webhook events');
  }
};

export const webhookReplayHandler = async (req: Request, res: Response) => {
  try {
    const deadLetterId = typeof req.body?.deadLetterId === 'string' ? req.body.deadLetterId : '';
    if (!deadLetterId) {
      res.status(400).json({ error: 'deadLetterId is required' });
      return;
    }
    const result = await replayDeadLetter(getUserId(req), deadLetterId);
    res.json(result);
  } catch (err) {
    handleWebhookError(err, res, 'Failed to replay webhook event');
  }
};

export const webhookVerifyNowHandler = async (req: Request, res: Response) => {
  try {
    const result = await verifyWebhookNow(getUserId(req));
    res.json(result);
  } catch (err) {
    handleWebhookError(err, res, 'Failed to verify webhook subscription');
  }
};

export const webhookReRegisterHandler = async (req: Request, res: Response) => {
  try {
    const result = await reRegisterWebhook(getUserId(req));
    res.json(result);
  } catch (err) {
    handleWebhookError(err, res, 'Failed to re-register webhook');
  }
};

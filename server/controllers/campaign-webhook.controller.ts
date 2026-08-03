import { Request, Response } from 'express';
import {
  verifyWebhookChallenge,
  verifyWebhookSignature,
  recordSignatureFailure,
  ingestWebhookPayload,
  CampaignWebhookError,
} from '../services/campaign-webhook.service';
import { webhookLogger } from '../lib/logger';

export const webhookVerifyHandler = async (req: Request, res: Response) => {
  try {
    const challenge = await verifyWebhookChallenge(req.query);
    res.status(200).send(challenge);
  } catch (err) {
    if (err instanceof CampaignWebhookError) {
      res.status(err.status).send('Forbidden');
      return;
    }
    console.error('Webhook verification error:', err);
    res.status(500).send('Error');
  }
};

export const webhookReceiveHandler = async (req: Request, res: Response) => {
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const rawBody = (req as any).rawBody as string | undefined;
  if (rawBody !== undefined && !verifyWebhookSignature(rawBody, signature)) {
    // Signature invalid -> drop immediately. Never inserted as a WebhookEvent
    // row, never processed - only recorded for security monitoring (health
    // metric + audit log), per the brief's explicit "never process unsigned
    // events."
    res.status(401).json({ error: 'Invalid signature' });
    void recordSignatureFailure(rawBody).catch((err) => console.error('Failed to record signature failure:', err));
    return;
  }

  // Acknowledge immediately - Meta expects a fast 200 and will retry on
  // timeout; heavy processing happens off this request entirely (queued as
  // WebhookEvent rows here, applied later by webhook-event-worker.service.ts).
  res.status(200).json({ received: true });
  try {
    await ingestWebhookPayload(req.body);
  } catch (err) {
    webhookLogger.error('WEBHOOK_INGEST_FAILED', { error: err instanceof Error ? err.message : String(err) });
  }
};

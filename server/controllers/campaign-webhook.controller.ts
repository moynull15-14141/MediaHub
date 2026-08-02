import { Request, Response } from 'express';
import { verifyWebhookChallenge, verifyWebhookSignature, processStatusWebhook, CampaignWebhookError } from '../services/campaign-webhook.service';

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
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  // Acknowledge immediately - Meta expects a fast 200 and will retry on
  // timeout; processing happens after the response is sent.
  res.status(200).json({ received: true });
  try {
    await processStatusWebhook(req.body);
  } catch (err) {
    console.error('Webhook processing error:', err);
  }
};

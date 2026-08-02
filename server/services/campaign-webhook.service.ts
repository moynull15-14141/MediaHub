import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { emitCampaignProgress } from '../lib/campaign-events';

export class CampaignWebhookError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// Meta's one-time subscription handshake: GET with hub.mode/hub.verify_token/
// hub.challenge - we must echo the challenge back if the verify token matches.
// There's exactly one webhook endpoint per deployment (one WHATSAPP_WEBHOOK_
// VERIFY_TOKEN) and Meta's handshake carries no internal userId, so a
// successful verification marks every connected account as verified - the
// same real limitation any single-webhook multi-tenant app has.
export const verifyWebhookChallenge = async (query: any): Promise<string> => {
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!verifyToken) throw new CampaignWebhookError('Webhook verify token is not configured', 500);
  if (query?.['hub.mode'] !== 'subscribe' || query?.['hub.verify_token'] !== verifyToken) {
    throw new CampaignWebhookError('Verification failed', 403);
  }
  await prisma.whatsappAccount.updateMany({ data: { webhookVerified: true, webhookLastPingAt: new Date() } });
  return String(query?.['hub.challenge'] ?? '');
};

// Optional defense in depth: if WHATSAPP_APP_SECRET is configured, verify
// Meta's X-Hub-Signature-256 header against the raw request body. Skipped
// (returns true) when no app secret is configured, since Phase 1's connect
// flow only collects a phone-number-scoped access token, not an app secret.
export const verifyWebhookSignature = (rawBody: string, signatureHeader: string | undefined): boolean => {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return true;
  if (!signatureHeader) return false;
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
};

const STATUS_MAP: Record<string, 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
};

// Correlates Meta's delivery-status callbacks back to our queue jobs via the
// metaMessageId captured when the message was sent, and stamps the owning
// account's webhookLast* columns so the Webhook Monitor reflects real events.
export const processStatusWebhook = async (payload: any): Promise<{ updated: number }> => {
  let updated = 0;
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const statuses = Array.isArray(change?.value?.statuses) ? change.value.statuses : [];
      for (const status of statuses) {
        const metaMessageId = status?.id;
        const mapped = STATUS_MAP[status?.status];
        if (!metaMessageId || !mapped) continue;

        const job = await prisma.campaignQueueJob.findUnique({ where: { metaMessageId } });
        if (!job) continue;

        // deliveredAt/readAt feed Phase 6's "Average Delivery Time"/"Average
        // Read Time" analytics - only stamped once, on first arrival of each
        // status, so a duplicate Meta webhook retry can't skew the average.
        const stageTimestamp: Record<string, unknown> = {};
        if (mapped === 'DELIVERED' && !job.deliveredAt) stageTimestamp.deliveredAt = new Date();
        if (mapped === 'READ' && !job.readAt) stageTimestamp.readAt = new Date();

        await prisma.campaignQueueJob.update({
          where: { id: job.id },
          data: { deliveryStatus: mapped, ...stageTimestamp },
        });
        updated += 1;
        emitCampaignProgress(job.campaignId);

        const campaign = await prisma.campaign.findUnique({ where: { id: job.campaignId }, select: { userId: true } });
        if (campaign) {
          const now = new Date();
          const extra: Record<string, unknown> = { webhookLastPingAt: now };
          if (mapped === 'DELIVERED') extra.webhookLastDeliveryAt = now;
          if (mapped === 'READ') extra.webhookLastReadAt = now;
          if (mapped === 'FAILED') {
            extra.webhookLastErrorAt = now;
            extra.webhookLastErrorMessage = status?.errors?.[0]?.title || 'Message delivery failed';
          }
          await prisma.whatsappAccount.update({ where: { userId: campaign.userId }, data: extra }).catch(() => {});
        }
      }
    }
  }

  return { updated };
};

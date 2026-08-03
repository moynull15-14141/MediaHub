import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { config } from '../lib/config';
import { webhookLogger } from '../lib/logger';
import { logAudit } from './whatsapp-audit.service';
import { deriveStatusEventId, deriveMessageEventId, deriveGenericEventId, hashPayload } from '../lib/webhook-ids';

export class CampaignWebhookError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// Meta's one-time subscription handshake: GET with hub.mode/hub.verify_token/
// hub.challenge - we must echo the challenge back if the verify token
// matches. There's exactly one webhook endpoint per deployment (one
// WHATSAPP_WEBHOOK_VERIFY_TOKEN) and Meta's handshake carries no internal
// userId, so a successful verification marks every connected account as
// verified - the same real limitation any single-webhook multi-tenant app
// has; unchanged from Phase 4/5. Phase B.4 additionally persists
// webhookVerifiedAt/webhookLastVerificationAttempt/webhookVerificationError
// so both a successful and a failed handshake attempt are now visible on the
// dashboard, not just a boolean.
export const verifyWebhookChallenge = async (query: any): Promise<string> => {
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  const now = new Date();
  if (!verifyToken) throw new CampaignWebhookError('Webhook verify token is not configured', 500);

  if (query?.['hub.mode'] !== 'subscribe' || query?.['hub.verify_token'] !== verifyToken) {
    await prisma.whatsappAccount.updateMany({
      data: { webhookLastVerificationAttempt: now, webhookVerificationError: 'Verification token mismatch' },
    });
    webhookLogger.warn('WEBHOOK_VERIFICATION_FAILED', { mode: query?.['hub.mode'] });
    throw new CampaignWebhookError('Verification failed', 403);
  }

  await prisma.whatsappAccount.updateMany({
    data: {
      webhookVerified: true,
      webhookVerifiedAt: now,
      webhookLastPingAt: now,
      webhookLastVerificationAttempt: now,
      webhookVerificationError: null,
    },
  });
  webhookLogger.info('WEBHOOK_VERIFIED', {});
  return String(query?.['hub.challenge'] ?? '');
};

// Optional defense in depth: if WHATSAPP_APP_SECRET is configured, verify
// Meta's X-Hub-Signature-256 header against the raw request body. Skipped
// (returns true) when no app secret is configured - this IS the brief's
// "allow local development mode through config": unset WHATSAPP_APP_SECRET
// locally and signature checking is a no-op, exactly as it was in Phase 4/5;
// set it (same var used for OAuth code exchange, config.meta.appSecret) and
// every unsigned or mis-signed request is rejected below.
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

// Phase B.4 - best-effort attribution for a rejected (invalid-signature)
// request. Reading the WABA id(s) out of the body to know WHICH account's
// health/audit trail to mark is not "processing" the event in the business
// sense (no message state changes, no queue job touched) - it is exactly the
// security-monitoring bookkeeping the brief's WEBHOOK_REJECTED log line and
// per-account signatureFailures health metric require. Failing to parse the
// body (e.g. it isn't even valid JSON) just means the failure is recorded
// without per-account attribution - never a reason to throw.
export const recordSignatureFailure = async (rawBody: string | undefined): Promise<void> => {
  webhookLogger.warn('WEBHOOK_REJECTED', { reason: 'invalid_signature' });

  let payload: any;
  try {
    payload = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    payload = null;
  }
  const wabaIds = new Set<string>();
  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    if (typeof entry?.id === 'string') wabaIds.add(entry.id);
  }
  if (wabaIds.size === 0) return;

  const now = new Date();
  await prisma.whatsappAccount.updateMany({
    where: { wabaId: { in: [...wabaIds] } },
    data: { webhookSignatureFailures: { increment: 1 }, webhookLastSignatureFailureAt: now },
  });
  const accounts = await prisma.whatsappAccount.findMany({
    where: { wabaId: { in: [...wabaIds] } },
    select: { userId: true, wabaId: true },
  });
  for (const account of accounts) {
    await logAudit(account.userId, 'WEBHOOK_SIGNATURE_FAILURE', account.wabaId ?? undefined);
  }
};

const resolveAccount = async (wabaId: string | null, phoneNumberId: string | null) => {
  if (wabaId) {
    const byWaba = await prisma.whatsappAccount.findFirst({ where: { wabaId } });
    if (byWaba) return byWaba;
  }
  if (phoneNumberId) {
    return prisma.whatsappAccount.findFirst({ where: { phoneNumberId } });
  }
  return null;
};

export interface IngestResult {
  received: number;
  duplicates: number;
}

// Phase B.4 - Idempotency + Performance. Replaces Phase 4/5's
// processStatusWebhook (which synchronously mutated CampaignQueueJob inline,
// once per whole POST body). This function does only the fast, durable part:
// split the payload into individual event units (one per status object, one
// per inbound message, one per any other "change"), and idempotently INSERT
// each as a WebhookEvent row - the eventId's @unique constraint IS the
// duplicate-protection mechanism (a Prisma P2002 on insert means Meta
// redelivered an identical event; recorded as a duplicate, never
// reprocessed). The actual business-logic mutation (delivery-status.service's
// applyStatusEvent) happens later, off the request/response path, in
// webhook-event-worker.service.ts's poller - this function itself never
// blocks the HTTP response and never touches CampaignQueueJob/Campaign.
export const ingestWebhookPayload = async (payload: any): Promise<IngestResult> => {
  let received = 0;
  let duplicates = 0;
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];

  for (const entry of entries) {
    const wabaId: string | null = typeof entry?.id === 'string' ? entry.id : null;
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];

    for (const change of changes) {
      const field: string = change?.field || 'unknown';
      const value = change?.value ?? {};
      const phoneNumberId: string | null = value?.metadata?.phone_number_id ?? null;
      const account = await resolveAccount(wabaId, phoneNumberId);
      const identityKey = wabaId ?? phoneNumberId ?? 'unknown';

      const units: { unit: unknown; eventId: string; wamid: string | null }[] = [];

      if (Array.isArray(value?.statuses) && value.statuses.length > 0) {
        for (const status of value.statuses) {
          const wamid: string | null = typeof status?.id === 'string' ? status.id : null;
          const eventId = wamid
            ? deriveStatusEventId(identityKey, wamid, String(status?.status ?? 'unknown'), String(status?.timestamp ?? ''))
            : deriveGenericEventId(identityKey, field, status);
          units.push({ unit: status, eventId, wamid });
        }
      } else if (Array.isArray(value?.messages) && value.messages.length > 0) {
        for (const message of value.messages) {
          const wamid: string | null = typeof message?.id === 'string' ? message.id : null;
          const eventId = wamid ? deriveMessageEventId(identityKey, wamid) : deriveGenericEventId(identityKey, field, message);
          units.push({ unit: message, eventId, wamid });
        }
      } else {
        // Any other change type (template status updates, account alerts,
        // quality/tier updates, ...) - no documented natural id, so the
        // whole `value` is the unit and its content hash is the identity.
        units.push({ unit: value, eventId: deriveGenericEventId(identityKey, field, value), wamid: null });
      }

      for (const { unit, eventId, wamid } of units) {
        received += 1;
        try {
          await prisma.webhookEvent.create({
            data: {
              eventId,
              wamid,
              eventType: field,
              workspaceId: account?.workspaceId ?? null,
              accountId: account?.id ?? null,
              wabaId,
              phoneNumberId,
              payloadHash: hashPayload(unit),
              rawPayload: unit as Prisma.InputJsonValue,
              maxRetries: config.webhook.maxRetryAttempts,
            },
          });
          webhookLogger.info('WEBHOOK_RECEIVED', { eventId, eventType: field, wamid, accountId: account?.id ?? null });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            duplicates += 1;
            await prisma.webhookEvent.updateMany({ where: { eventId }, data: { duplicateAttempts: { increment: 1 } } });
            webhookLogger.info('WEBHOOK_DUPLICATE', { eventId, eventType: field, wamid });
          } else {
            webhookLogger.error('WEBHOOK_INGEST_ERROR', { eventId, error: err instanceof Error ? err.message : String(err) });
          }
        }
      }
    }
  }

  return { received, duplicates };
};

export interface ListWebhookEventsOptions {
  page?: number;
  pageSize?: number;
}

// Self-service - GET /account/webhook/events. Same pagination shape as
// listAuditLogs/listHealthHistory/getCampaignLogs.
export const listWebhookEvents = async (userId: string, options: ListWebhookEventsOptions) => {
  const account = await prisma.whatsappAccount.findUnique({ where: { userId }, select: { id: true } });
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 25));
  if (!account) return { items: [], total: 0, page, pageSize, totalPages: 1 };

  const where = { accountId: account.id };
  const [items, total] = await Promise.all([
    prisma.webhookEvent.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.webhookEvent.count({ where }),
  ]);
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

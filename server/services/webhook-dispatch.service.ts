import type { WebhookEvent } from '@prisma/client';
import { applyStatusEvent } from './delivery-status.service';
import { webhookLogger } from '../lib/logger';

// Phase B.4 - single dispatch point by eventType (Meta's `change.field`
// value), shared by both the normal worker tick (webhook-event-worker.
// service.ts) and manual dead-letter replay (webhook-dead-letter.service.ts)
// so there is exactly one implementation of "what does processing this kind
// of event actually do" - never two that could drift out of sync.
export const dispatchWebhookEvent = async (event: Pick<WebhookEvent, 'eventType' | 'rawPayload'>): Promise<void> => {
  switch (event.eventType) {
    case 'statuses':
      await applyStatusEvent(event.rawPayload as any);
      return;
    default:
      // messages (inbound), message_template_status_update, account_alerts,
      // account_update, phone_number_quality_update, etc. - no existing
      // consumer in this codebase acts on these today ("campaign sending
      // logic must remain unchanged" - this phase does not invent a new
      // inbound-messaging feature). Durably recorded and acknowledged as
      // processed regardless, so idempotency/audit-trail coverage is
      // complete for every event type Meta sends, not only delivery
      // statuses.
      webhookLogger.debug('WEBHOOK_EVENT_ACKNOWLEDGED', { eventType: event.eventType });
      return;
  }
};

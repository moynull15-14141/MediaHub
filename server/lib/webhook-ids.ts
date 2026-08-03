import crypto from 'crypto';

// Phase B.4 - deterministic identity for a single Meta webhook event unit
// (one status object, one inbound message, or one other "change"). Meta's
// payload itself carries no single global event id - these are the natural
// keys each event type actually has, matching Meta's own documented
// uniqueness guarantees:
//   - a status update is uniquely identified by (message id, status, time) -
//     the same wamid legitimately produces multiple DISTINCT status events
//     (sent, then delivered, then read), so hashing only the wamid would
//     wrongly collapse them into one.
//   - an inbound message is uniquely identified by its own message id alone.
//   - anything else (template status updates, account alerts, ...) has no
//     documented natural id, so the full unit payload is hashed as a
//     last-resort content-based identity - still correctly de-duplicates an
//     exact-duplicate redelivery, Meta's actual retry behavior.
export const deriveStatusEventId = (wabaId: string, wamid: string, status: string, timestamp: string): string =>
  crypto.createHash('sha256').update(`status:${wabaId}:${wamid}:${status}:${timestamp}`).digest('hex');

export const deriveMessageEventId = (wabaId: string, messageId: string): string =>
  crypto.createHash('sha256').update(`message:${wabaId}:${messageId}`).digest('hex');

export const deriveGenericEventId = (wabaId: string, field: string, unit: unknown): string =>
  crypto.createHash('sha256').update(`generic:${wabaId}:${field}:${JSON.stringify(unit)}`).digest('hex');

export const hashPayload = (unit: unknown): string =>
  crypto.createHash('sha256').update(JSON.stringify(unit)).digest('hex');

// Phase B.4 - the Retry Engine's "retryable vs not" rule for webhook event
// processing, mirroring the exact convention whatsapp-sender.ts already uses
// for campaign sends (SendMessageResult.retryable). Default true (retryable)
// when a handler throws a plain Error - the safe default, since the common
// failure modes during processing (DB timeout, network blip, a transient
// Graph outage) are all transient. Handlers only need to throw this
// explicitly when they know a failure is permanent (e.g. the payload itself
// is structurally invalid and will never succeed no matter how many times
// it's retried).
export class WebhookProcessingError extends Error {
  constructor(message: string, public retryable: boolean = true) {
    super(message);
  }
}

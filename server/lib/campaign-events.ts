import { EventEmitter } from 'events';

// Lets the worker push progress instantly to any subscribed SSE connections
// instead of the browser having to poll. Single process, single emitter -
// no external pub/sub needed.
export const campaignEvents = new EventEmitter();
campaignEvents.setMaxListeners(0);

export const emitCampaignProgress = (campaignId: string) => {
  campaignEvents.emit('progress', campaignId);
};

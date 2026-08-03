import type { WhatsappAccount } from '@prisma/client';

// Phase B.5 - Rate Limit Manager. Extracted from campaign-queue-worker.
// service.ts's original inline rateState Map (Phase 4's sliding-window +
// jitter-delay limiter, unchanged in behavior) and given a second axis: an
// adaptive backoff multiplier that grows on a real Meta 429 and decays back
// to 1 on successful sends - "slow sending, increase delay, recover
// automatically" per the brief. Keyed by accountId only, and every account
// belongs to exactly one workspace (WhatsappAccount.workspaceId is 1:1 with
// the account, never shared) - so this is inherently workspace-isolated
// without needing a workspaceId in the key.
interface RateState {
  sentTimestamps: number[];
  nextAllowedAt: number;
  backoffMultiplier: number;
  consecutive429s: number;
  lastRateLimitedAt: number | null;
}

const MAX_BACKOFF_MULTIPLIER = 8;
const BACKOFF_DECAY_FACTOR = 0.85;

const state = new Map<string, RateState>();

const getState = (accountId: string): RateState => {
  let entry = state.get(accountId);
  if (!entry) {
    entry = { sentTimestamps: [], nextAllowedAt: 0, backoffMultiplier: 1, consecutive429s: 0, lastRateLimitedAt: null };
    state.set(accountId, entry);
  }
  return entry;
};

export const canSendForAccount = (accountId: string, account: Pick<WhatsappAccount, 'rateLimitPerMinute'>): boolean => {
  const entry = getState(accountId);
  const now = Date.now();
  if (now < entry.nextAllowedAt) return false;
  entry.sentTimestamps = entry.sentTimestamps.filter((t) => now - t < 60_000);
  // A sustained backoff also throttles the effective per-minute budget, not
  // just the delay between sends - otherwise a very high configured
  // rateLimitPerMinute would let the burst right back into another 429.
  const effectiveLimit = Math.max(1, Math.floor(account.rateLimitPerMinute / entry.backoffMultiplier));
  return entry.sentTimestamps.length < effectiveLimit;
};

export const recordSend = (accountId: string, account: Pick<WhatsappAccount, 'minDelaySeconds' | 'maxDelaySeconds'>): void => {
  const entry = getState(accountId);
  const now = Date.now();
  entry.sentTimestamps.push(now);
  const min = Math.max(1, account.minDelaySeconds);
  const max = Math.max(min, account.maxDelaySeconds);
  const jitterSeconds = (min + Math.random() * (max - min)) * entry.backoffMultiplier;
  entry.nextAllowedAt = now + jitterSeconds * 1000;
};

// Called on every Meta 429 - doubles the backoff (capped) and marks when it
// last happened, so recovery (below) can tell "genuinely quiet again" apart
// from "just started."
export const recordRateLimitHit = (accountId: string): void => {
  const entry = getState(accountId);
  entry.consecutive429s += 1;
  entry.backoffMultiplier = Math.min(MAX_BACKOFF_MULTIPLIER, entry.backoffMultiplier * 2);
  entry.lastRateLimitedAt = Date.now();
};

// Called on every successful send - decays the backoff gradually rather than
// snapping straight back to 1, so one lucky send right after a 429 doesn't
// immediately re-trigger the same rate limit.
export const recordSendSuccess = (accountId: string): void => {
  const entry = getState(accountId);
  entry.consecutive429s = 0;
  if (entry.backoffMultiplier > 1) {
    entry.backoffMultiplier = Math.max(1, entry.backoffMultiplier * BACKOFF_DECAY_FACTOR);
  }
};

export interface RateLimitSnapshot {
  sentLastMinute: number;
  configuredLimitPerMinute: number;
  effectiveLimitPerMinute: number;
  backoffMultiplier: number;
  consecutive429s: number;
  lastRateLimitedAt: Date | null;
  throttled: boolean;
}

// Read-only view for the Operations Engine's /account/limits endpoint -
// never mutates state, safe to call from a request handler.
export const getRateLimitSnapshot = (accountId: string, configuredLimitPerMinute: number): RateLimitSnapshot => {
  const entry = state.get(accountId);
  if (!entry) {
    return {
      sentLastMinute: 0,
      configuredLimitPerMinute,
      effectiveLimitPerMinute: configuredLimitPerMinute,
      backoffMultiplier: 1,
      consecutive429s: 0,
      lastRateLimitedAt: null,
      throttled: false,
    };
  }
  const now = Date.now();
  const sentLastMinute = entry.sentTimestamps.filter((t) => now - t < 60_000).length;
  return {
    sentLastMinute,
    configuredLimitPerMinute,
    effectiveLimitPerMinute: Math.max(1, Math.floor(configuredLimitPerMinute / entry.backoffMultiplier)),
    backoffMultiplier: Math.round(entry.backoffMultiplier * 100) / 100,
    consecutive429s: entry.consecutive429s,
    lastRateLimitedAt: entry.lastRateLimitedAt ? new Date(entry.lastRateLimitedAt) : null,
    throttled: entry.backoffMultiplier > 1,
  };
};

import type { WhatsappAccount } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { pauseCampaignsForAccountFailover, resumeAutoPausedCampaignsForAccount } from './campaign-queue.service';
import { logAudit } from './whatsapp-audit.service';
import { operationsLogger } from '../lib/logger';

// Phase B.5 - Daily Limit Engine. Supersedes campaign-queue-worker.service.
// ts's old inline isUnderDailyLimit (which silently skipped dispatch and
// self-reset the counter with no pause/audit trail). Split in two so the
// hot 2s dispatch loop keeps a cheap, side-effect-free read, while the
// side-effecting reset/pause/resume/audit work runs on the existing 30-min
// health-scheduler cadence (same tradeoff Token Lifecycle already makes for
// auto-pause/auto-resume - a UTC-midnight rollover doesn't need
// sub-30-minute reaction time).
export const isSameUtcDay = (a: Date, b: Date): boolean =>
  a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();

// Pure - no DB writes. Treats a stale lastDailyReset (from a previous UTC
// day) as "0 sent today" without persisting the reset itself; the actual
// reset is enforceDailyLimit's job below. Shared by account-routing.service.ts
// (usability check) and the hot dispatch loop, so there is exactly one
// definition of "is this account currently under its daily cap."
export const isWithinDailyLimit = (
  account: Pick<WhatsappAccount, 'dailyLimit' | 'currentDailySent' | 'lastDailyReset'>,
  now: Date = new Date(),
): boolean => {
  if (account.dailyLimit == null) return true;
  const sentToday = account.lastDailyReset && isSameUtcDay(account.lastDailyReset, now) ? account.currentDailySent : 0;
  return sentToday < account.dailyLimit;
};

// Side-effecting - called once per account per 30-min health-scheduler tick.
// Performs the UTC rollover (reset counter + re-enable + resume if THIS
// engine was the one that disabled sending), and pauses + disables + audits
// exactly once per threshold crossing (naturally idempotent: once
// sendingEnabled is false, currentDailySent only ever grows via real sends,
// which can't happen on a disabled account, so this branch won't re-fire
// until the next UTC day resets it).
export const enforceDailyLimit = async (account: WhatsappAccount): Promise<void> => {
  if (account.dailyLimit == null) return;
  const now = new Date();

  if (!account.lastDailyReset || !isSameUtcDay(account.lastDailyReset, now)) {
    await prisma.whatsappAccount.update({ where: { id: account.id }, data: { currentDailySent: 0, lastDailyReset: now } });
    account.currentDailySent = 0;
    account.lastDailyReset = now;

    // Re-read fresh: quality/webhook monitors running in this same tick may
    // have already changed sendingDisabledReason in the DB since `account`
    // was fetched at the top of the tick - never trust the in-memory copy
    // for this decision.
    const fresh = await prisma.whatsappAccount.findUnique({ where: { id: account.id }, select: { sendingDisabledReason: true } });
    if (fresh?.sendingDisabledReason === 'DAILY_LIMIT') {
      await prisma.whatsappAccount.update({ where: { id: account.id }, data: { sendingEnabled: true, sendingDisabledReason: null } });
      const resumedCount = await resumeAutoPausedCampaignsForAccount(account.id);
      await logAudit(account.userId, 'DAILY_LIMIT_RESET', `resumed ${resumedCount} campaign(s)`);
      operationsLogger.info('DAILY_LIMIT_RESET', { accountId: account.id, resumedCount });
    }
  }

  if (account.currentDailySent >= account.dailyLimit) {
    const fresh = await prisma.whatsappAccount.findUnique({ where: { id: account.id }, select: { sendingEnabled: true } });
    if (fresh?.sendingEnabled) {
      await prisma.whatsappAccount.update({
        where: { id: account.id },
        data: { sendingEnabled: false, sendingDisabledReason: 'DAILY_LIMIT' },
      });
      const pausedCount = await pauseCampaignsForAccountFailover(
        account.id,
        `Daily send limit reached (${account.currentDailySent}/${account.dailyLimit})`,
      );
      await logAudit(account.userId, 'DAILY_LIMIT_REACHED', `paused ${pausedCount} campaign(s)`);
      operationsLogger.warn('DAILY_LIMIT_REACHED', { accountId: account.id, sent: account.currentDailySent, limit: account.dailyLimit, pausedCount });
    }
  }
};

export class DailyLimitError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// POST /account/reset-daily-limit - manual override for an operator who
// wants to lift today's cap early. Only clears sendingDisabledReason when
// THIS engine was the one that set it (same rule enforceDailyLimit's
// automatic reset already follows) - never re-enables an account a human
// disabled manually or that quality/webhook monitoring disabled.
export const resetDailyLimitNow = async (userId: string): Promise<{ resumedCount: number }> => {
  const account = await prisma.whatsappAccount.findUnique({ where: { userId } });
  if (!account) throw new DailyLimitError('No WhatsApp account is connected', 404);

  const now = new Date();
  const data: Record<string, unknown> = { currentDailySent: 0, lastDailyReset: now };
  if (account.sendingDisabledReason === 'DAILY_LIMIT') {
    data.sendingEnabled = true;
    data.sendingDisabledReason = null;
  }
  await prisma.whatsappAccount.update({ where: { id: account.id }, data });

  let resumedCount = 0;
  if (account.sendingDisabledReason === 'DAILY_LIMIT') {
    resumedCount = await resumeAutoPausedCampaignsForAccount(account.id);
  }
  await logAudit(userId, 'DAILY_LIMIT_MANUAL_RESET', `resumed ${resumedCount} campaign(s)`);
  operationsLogger.info('DAILY_LIMIT_MANUAL_RESET', { accountId: account.id, resumedCount });
  return { resumedCount };
};

// GET /account/limits + Operations Engine composition.
export const getDailyLimitSnapshot = (account: Pick<WhatsappAccount, 'dailyLimit' | 'currentDailySent' | 'lastDailyReset'>) => {
  const now = new Date();
  const sentToday = account.lastDailyReset && isSameUtcDay(account.lastDailyReset, now) ? account.currentDailySent : 0;
  return {
    dailyLimit: account.dailyLimit,
    sentToday,
    withinLimit: isWithinDailyLimit(account, now),
    remaining: account.dailyLimit != null ? Math.max(0, account.dailyLimit - sentToday) : null,
  };
};

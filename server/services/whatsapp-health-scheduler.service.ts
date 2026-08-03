import { prisma } from '../lib/prisma';
import { validateAccount, requiresAutoPause, type TokenStatus } from './meta-validation.service';
import { pauseCampaignsForAccountFailover, resumeAutoPausedCampaignsForAccount } from './campaign-queue.service';
import { logAudit } from './whatsapp-audit.service';
import { tokenLogger } from '../lib/logger';

// Mirrors report-scheduler.service.ts's polling convention exactly (bare
// setInterval + re-entrancy guard) rather than introducing node-cron or any
// other scheduling library - this repo's established convention, not new.
// Phase B.3 extends this same scheduler (no second one) with the token
// lifecycle state machine's auto-pause/auto-resume reactions.
const POLL_INTERVAL_MS = 30 * 60 * 1000;

// Bounds concurrent Graph API calls without adding a dependency (no p-limit)
// - a handful of slow/broken accounts can't serialize the whole tick, and
// the queue worker (its own independent 2-second interval) is never blocked
// by this either way since the two schedulers share nothing but the DB.
const VALIDATION_CONCURRENCY = 5;

let timer: NodeJS.Timeout | null = null;
let tickRunning = false;
let lastTickAt: Date | null = null;

// Mirrors getWorkerHeartbeat()/getSchedulerHeartbeat() - future System
// Health card can surface this the same way.
export const getHealthSchedulerHeartbeat = (): { running: boolean; lastTickAt: Date | null } => ({
  running: timer !== null,
  lastTickAt,
});

const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const validateOneAccount = async (account: { id: string; userId: string; workspaceId: string; tokenStatus: string }): Promise<void> => {
  const previousStatus = account.tokenStatus as TokenStatus;
  try {
    const result = await validateAccount(account.workspaceId, account.userId);
    const nextStatus = result.validation.tokenStatus as TokenStatus;
    if (previousStatus === nextStatus) return;

    if (!requiresAutoPause(previousStatus) && requiresAutoPause(nextStatus)) {
      const reason = `Token status changed ${previousStatus} -> ${nextStatus}: ${result.validation.message}`;
      const pausedCount = await pauseCampaignsForAccountFailover(account.id, reason);
      await logAudit(account.userId, 'AUTO_PAUSE', `${previousStatus} -> ${nextStatus}, paused ${pausedCount} campaign(s)`);
      tokenLogger.info('AUTO_PAUSE', { accountId: account.id, workspaceId: account.workspaceId, previousStatus, nextStatus, pausedCount });
    } else if (requiresAutoPause(previousStatus) && nextStatus === 'CONNECTED') {
      const resumedCount = await resumeAutoPausedCampaignsForAccount(account.id);
      await logAudit(account.userId, 'AUTO_RESUME', `${previousStatus} -> CONNECTED, resumed ${resumedCount} campaign(s)`);
      tokenLogger.info('AUTO_RESUME', { accountId: account.id, workspaceId: account.workspaceId, previousStatus, resumedCount });
    }
  } catch (err) {
    console.error(`WhatsApp health check failed for account ${account.id}:`, err);
  }
};

const runHealthChecks = async (): Promise<void> => {
  const accounts = await prisma.whatsappAccount.findMany({
    where: { status: 'CONNECTED' },
    select: { id: true, userId: true, workspaceId: true, tokenStatus: true },
  });

  for (const batch of chunk(accounts, VALIDATION_CONCURRENCY)) {
    await Promise.allSettled(batch.map(validateOneAccount));
  }
};

const tick = async (): Promise<void> => {
  if (tickRunning) return;
  tickRunning = true;
  try {
    await runHealthChecks();
    lastTickAt = new Date();
  } catch (err) {
    console.error('WhatsApp health scheduler tick error:', err);
  } finally {
    tickRunning = false;
  }
};

export const startWhatsappHealthScheduler = (): void => {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);
  console.log('WhatsApp account health scheduler started');
};

export const stopWhatsappHealthScheduler = async (): Promise<void> => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  while (tickRunning) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

import os from 'os';
import fs from 'fs';
import { prisma } from '../lib/prisma';
import { checkR2Health } from '../lib/r2';
import { getWorkerHeartbeat } from './campaign-queue-worker.service';
import { getApiHealth } from './api-health.service';

export type HealthStatus = 'green' | 'yellow' | 'red';

export interface HealthCard {
  name: string;
  status: HealthStatus;
  detail: string;
}

const WORKER_STALE_MS = 10_000;

export const getSystemHealth = async (userId: string): Promise<HealthCard[]> => {
  const cards: HealthCard[] = [];

  // Database
  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const latency = Date.now() - start;
    cards.push({ name: 'Database', status: latency < 200 ? 'green' : 'yellow', detail: `${latency}ms` });
  } catch (err: any) {
    cards.push({ name: 'Database', status: 'red', detail: err.message || 'Unreachable' });
  }

  // Queue Worker
  const heartbeat = getWorkerHeartbeat();
  if (!heartbeat.running) {
    cards.push({ name: 'Queue Worker', status: 'red', detail: 'Not running' });
  } else if (!heartbeat.lastTickAt || Date.now() - heartbeat.lastTickAt.getTime() > WORKER_STALE_MS) {
    cards.push({ name: 'Queue Worker', status: 'yellow', detail: 'No recent tick' });
  } else {
    cards.push({ name: 'Queue Worker', status: 'green', detail: `Last tick ${Date.now() - heartbeat.lastTickAt.getTime()}ms ago` });
  }

  // Webhook
  const account = await prisma.whatsappAccount.findUnique({ where: { userId } });
  if (!account) {
    cards.push({ name: 'Webhook', status: 'yellow', detail: 'No account connected' });
  } else if (account.webhookLastErrorAt && (!account.webhookLastPingAt || account.webhookLastErrorAt > account.webhookLastPingAt)) {
    cards.push({ name: 'Webhook', status: 'red', detail: account.webhookLastErrorMessage || 'Last event was an error' });
  } else if (!account.webhookVerified) {
    cards.push({ name: 'Webhook', status: 'yellow', detail: 'Not yet verified by Meta' });
  } else {
    cards.push({ name: 'Webhook', status: 'green', detail: 'Verified and receiving events' });
  }

  // Cloudflare R2
  const r2 = await checkR2Health();
  cards.push({
    name: 'Cloudflare R2',
    status: r2.healthy ? (r2.latencyMs < 500 ? 'green' : 'yellow') : 'red',
    detail: r2.healthy ? `${r2.latencyMs}ms` : r2.error || 'Unreachable',
  });

  // Meta API (derived from today's send success rate)
  const apiHealth = await getApiHealth(userId);
  if (apiHealth.totalRequestsToday === 0) {
    cards.push({ name: 'Meta API', status: 'green', detail: 'No requests sent today' });
  } else {
    cards.push({
      name: 'Meta API',
      status: apiHealth.successPercent >= 90 ? 'green' : apiHealth.successPercent >= 70 ? 'yellow' : 'red',
      detail: `${apiHealth.successPercent}% success (${apiHealth.totalRequestsToday} today)`,
    });
  }

  // Server
  cards.push({ name: 'Server', status: 'green', detail: `Up ${Math.round(process.uptime())}s` });

  // Memory
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedPercent = Math.round(((totalMem - freeMem) / totalMem) * 100);
  cards.push({
    name: 'Memory',
    status: usedPercent < 80 ? 'green' : usedPercent < 92 ? 'yellow' : 'red',
    detail: `${usedPercent}% used`,
  });

  // CPU (1-minute load average relative to core count)
  const cpuCount = os.cpus().length || 1;
  const load1 = os.loadavg()[0];
  const loadPercent = Math.round((load1 / cpuCount) * 100);
  cards.push({
    name: 'CPU',
    status: loadPercent < 70 ? 'green' : loadPercent < 90 ? 'yellow' : 'red',
    detail: `${loadPercent}% load`,
  });

  // Disk (best-effort; not every platform/Node version supports statfsSync)
  try {
    const stats = (fs as any).statfsSync?.('/');
    if (stats) {
      const diskUsedPercent = Math.round(((stats.blocks - stats.bfree) / stats.blocks) * 100);
      cards.push({
        name: 'Disk',
        status: diskUsedPercent < 85 ? 'green' : diskUsedPercent < 95 ? 'yellow' : 'red',
        detail: `${diskUsedPercent}% used`,
      });
    } else {
      cards.push({ name: 'Disk', status: 'yellow', detail: 'Not available on this platform' });
    }
  } catch {
    cards.push({ name: 'Disk', status: 'yellow', detail: 'Not available on this platform' });
  }

  return cards;
};

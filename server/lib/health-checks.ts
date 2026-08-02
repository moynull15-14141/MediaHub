import os from 'os';
import fs from 'fs';
import { prisma } from './prisma';

export type HealthLevel = 'healthy' | 'warning' | 'critical';

// Low-level, reusable health primitives (Phase A.4). Extracted so the
// existing per-workspace system-health.service.ts (Phase 5, WhatsApp
// Settings > System Health tab) and the new app-level /api/health,
// /api/system, /api/system/diagnostics endpoints share one implementation
// of "what does a healthy DB/memory/CPU/disk number look like" instead of
// two copies that could drift.

export const checkDatabase = async (): Promise<{ level: HealthLevel; latencyMs: number; error?: string }> => {
  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - start;
    return { level: latencyMs < 200 ? 'healthy' : 'warning', latencyMs };
  } catch (err: any) {
    return { level: 'critical', latencyMs: -1, error: err.message || 'Unreachable' };
  }
};

export const checkMemory = (): { level: HealthLevel; usedPercent: number; heapUsedMB: number; heapTotalMB: number; rssMB: number } => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedPercent = Math.round(((totalMem - freeMem) / totalMem) * 100);
  const mem = process.memoryUsage();
  return {
    level: usedPercent < 80 ? 'healthy' : usedPercent < 92 ? 'warning' : 'critical',
    usedPercent,
    heapUsedMB: Math.round(mem.heapUsed / (1024 * 1024)),
    heapTotalMB: Math.round(mem.heapTotal / (1024 * 1024)),
    rssMB: Math.round(mem.rss / (1024 * 1024)),
  };
};

export const checkCpu = (): { level: HealthLevel; loadPercent: number; cores: number } => {
  const cpuCount = os.cpus().length || 1;
  const load1 = os.loadavg()[0];
  const loadPercent = Math.round((load1 / cpuCount) * 100);
  return { level: loadPercent < 70 ? 'healthy' : loadPercent < 90 ? 'warning' : 'critical', loadPercent, cores: cpuCount };
};

export const checkDisk = (): { level: HealthLevel; usedPercent: number | null; available: boolean } => {
  try {
    const stats = (fs as any).statfsSync?.('/');
    if (!stats) return { level: 'warning', usedPercent: null, available: false };
    const usedPercent = Math.round(((stats.blocks - stats.bfree) / stats.blocks) * 100);
    return { level: usedPercent < 85 ? 'healthy' : usedPercent < 95 ? 'warning' : 'critical', usedPercent, available: true };
  } catch {
    return { level: 'warning', usedPercent: null, available: false };
  }
};

export const worstLevel = (levels: HealthLevel[]): HealthLevel => {
  if (levels.includes('critical')) return 'critical';
  if (levels.includes('warning')) return 'warning';
  return 'healthy';
};

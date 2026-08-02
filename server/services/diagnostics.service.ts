import fs from 'fs';
import { Prisma } from '@prisma/client';
import { checkDatabase, checkMemory, checkCpu, checkDisk, worstLevel, HealthLevel } from '../lib/health-checks';
import { checkR2Health } from '../lib/r2';
import { config } from '../lib/config';
import { getWorkerHeartbeat } from './campaign-queue-worker.service';
import { getSchedulerHeartbeat } from './report-scheduler.service';
import { prisma } from '../lib/prisma';

const isDocker = (): boolean => {
  try {
    return fs.existsSync('/.dockerenv');
  } catch {
    return false;
  }
};

// Liveness (Part 1, GET /health) - deliberately cheap: no DB round-trip, no
// R2 call. Meant for a load balancer / uptime probe hitting this every few
// seconds; those two other checks belong in /system instead.
export const getLiveness = () => ({
  status: 'healthy' as HealthLevel,
  uptimeSeconds: Math.round(process.uptime()),
  timestamp: new Date().toISOString(),
});

// Readiness (Part 1, GET /status) - "can this instance actually serve
// traffic right now" - just the one dependency that would make every
// request fail: the database.
export const getReadiness = async () => {
  const db = await checkDatabase();
  return {
    status: db.level,
    database: db.level === 'critical' ? 'unreachable' : 'ok',
    timestamp: new Date().toISOString(),
  };
};

// Full subsystem status (Part 1, GET /system) - every dependency, each with
// its own healthy/warning/critical, plus one overall verdict.
export const getSystemStatus = async () => {
  const [database, r2] = await Promise.all([checkDatabase(), checkR2Health()]);
  const memory = checkMemory();
  const cpu = checkCpu();
  const disk = checkDisk();
  const worker = getWorkerHeartbeat();
  const scheduler = getSchedulerHeartbeat();

  const workerLevel: HealthLevel = !worker.running ? 'critical' : !worker.lastTickAt ? 'warning' : 'healthy';
  const schedulerLevel: HealthLevel = !scheduler.running ? 'critical' : 'healthy';
  const storageLevel: HealthLevel = r2.healthy ? (r2.latencyMs < 500 ? 'healthy' : 'warning') : 'critical';
  const jwtLevel: HealthLevel = config.jwtSecretIsDefault ? 'warning' : 'healthy';

  const overall = worstLevel([database.level, memory.level, cpu.level, disk.level, workerLevel, schedulerLevel, storageLevel, jwtLevel]);

  return {
    status: overall,
    checks: {
      application: { status: 'healthy' as HealthLevel, uptimeSeconds: Math.round(process.uptime()) },
      database: { status: database.level, latencyMs: database.latencyMs, error: database.error },
      prisma: { status: 'healthy' as HealthLevel, clientVersion: Prisma.prismaVersion.client },
      worker: { status: workerLevel, running: worker.running, lastTickAt: worker.lastTickAt },
      queue: { status: workerLevel, running: worker.running },
      scheduler: { status: schedulerLevel, running: scheduler.running, lastTickAt: scheduler.lastTickAt },
      jwt: { status: jwtLevel, usingDefaultSecret: config.jwtSecretIsDefault },
      storage: { status: storageLevel, latencyMs: r2.healthy ? r2.latencyMs : null, error: r2.healthy ? undefined : r2.error },
      memory: { status: memory.level, usedPercent: memory.usedPercent, heapUsedMB: memory.heapUsedMB, heapTotalMB: memory.heapTotalMB },
      cpu: { status: cpu.level, loadPercent: cpu.loadPercent, cores: cpu.cores },
      disk: { status: disk.level, usedPercent: disk.usedPercent, available: disk.available },
    },
    timestamp: new Date().toISOString(),
  };
};

// Deep diagnostics (Part 2, GET /api/system/diagnostics) - the raw facts an
// operator would want when actually debugging a problem, beyond just a
// traffic-light summary. Intentionally more expensive/verbose than /system.
export const getDiagnostics = async () => {
  const [system, dbVersion] = await Promise.all([
    getSystemStatus(),
    prisma.$queryRaw<{ version: string }[]>`SELECT version()`.catch(() => null),
  ]);

  let migrationStatus: { applied: number; pending: boolean } = { applied: 0, pending: false };
  try {
    const rows = await prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
    migrationStatus = { applied: Number(rows[0]?.count ?? 0), pending: false };
  } catch {
    // _prisma_migrations not reachable (e.g. DB down) - system.database already reflects that.
  }

  return {
    application: {
      version: config.appVersion,
      buildTime: config.buildTime,
      environment: config.nodeEnv,
      nodeVersion: process.version,
    },
    prisma: {
      clientVersion: Prisma.prismaVersion.client,
      migrations: migrationStatus,
    },
    database: {
      version: dbVersion?.[0]?.version ?? 'unknown',
      status: system.checks.database.status,
      latencyMs: system.checks.database.latencyMs,
    },
    docker: { detected: isDocker() },
    worker: system.checks.worker,
    scheduler: system.checks.scheduler,
    jwt: system.checks.jwt,
    storage: system.checks.storage,
    environment: {
      required: {
        JWT_SECRET: !config.jwtSecretIsDefault,
        DATABASE_URL: Boolean(config.databaseUrl),
        R2: Boolean(config.r2.accountId && config.r2.accessKeyId && config.r2.secretAccessKey && config.r2.bucketName),
      },
      optional: {
        SMTP: config.smtp.configured,
        MetaAppSecret: config.meta.configured,
        Redis: config.redis.configured,
      },
    },
    overallStatus: system.status,
    timestamp: new Date().toISOString(),
  };
};

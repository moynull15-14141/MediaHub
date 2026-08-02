import { config } from './config';
import { appLogger } from './logger';
import { checkDatabase } from './health-checks';
import { checkR2Health } from './r2';

// Part 7/8 (Environment + Startup Validation). Deliberately conservative
// about what actually fails startup: this deployment currently runs with no
// JWT_SECRET set (falls back to a safe default, logged as a warning below) -
// hard-failing on that today would stop the existing, working app from
// booting at all on the next rebuild, which is exactly what "nothing may
// break" rules out. Only DATABASE_URL being completely unset is treated as
// unrecoverable, since literally nothing in this app functions without a
// database connection string and there is no fallback path for it the way
// there is for JWT_SECRET.
export const validateEnvironment = (): void => {
  const missing: string[] = [];
  if (!config.databaseUrl) missing.push('DATABASE_URL');

  if (missing.length > 0) {
    appLogger.error('Missing required environment variables - refusing to start', { missing });
    process.exit(1);
  }

  if (config.jwtSecretIsDefault) {
    appLogger.warn('JWT_SECRET is not set - using the built-in development default. Set it explicitly before real production use.');
  }
  const r2Configured = Boolean(config.r2.accountId && config.r2.accessKeyId && config.r2.secretAccessKey && config.r2.bucketName);
  if (!r2Configured) {
    appLogger.warn('Cloudflare R2 is not fully configured - Converter/Image/PDF/WhatsApp attachment uploads will fail until it is.');
  }
  if (!config.smtp.configured) appLogger.info('SMTP not configured (optional) - no email-sending features are active.');
  if (!config.meta.configured) appLogger.info('WHATSAPP_APP_SECRET not configured (optional) - webhook signature verification is skipped.');
  if (!config.redis.configured) appLogger.info('Redis not configured (optional) - no code path currently requires it.');
};

// Part 8: verifies the app's actual runtime dependencies are reachable
// before declaring startup complete - DB connectivity and R2 reachability
// are checked for real (not just "is the env var present"). Failure here
// logs loudly but does not exit the process: Postgres/R2 have their own
// retry/backoff at the query level already (Prisma reconnects, R2 SDK
// retries), and a container that exits on a transient network blip during
// boot is worse than one that starts and self-heals on the first real
// request.
export const validateStartupDependencies = async (): Promise<void> => {
  const db = await checkDatabase();
  if (db.level === 'critical') {
    appLogger.error('Database is unreachable at startup', { error: db.error });
  } else {
    appLogger.info('Database reachable', { latencyMs: db.latencyMs });
  }

  const r2 = await checkR2Health();
  if (!r2.healthy) {
    appLogger.warn('Cloudflare R2 is unreachable at startup', { error: r2.error });
  } else {
    appLogger.info('Cloudflare R2 reachable', { latencyMs: r2.latencyMs });
  }
};

// Central typed configuration (Phase A.4, Part 9). Every env var this file
// exposes should be read from here, not scattered process.env.<X> calls -
// applies to all NEW code written for this phase; pre-existing scattered
// reads (R2, WHATSAPP_*, etc.) are untouched here since migrating ~50 call
// sites across working services is a separate, lower-value follow-up, not
// part of this pass (see startup-validation.ts for why: it validates the
// underlying env vars directly, so those call sites are still covered).

const bool = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined ? fallback : value === 'true' || value === '1';

const int = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return value !== undefined && Number.isFinite(n) ? n : fallback;
};

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: int(process.env.PORT, 3000),
  appVersion: process.env.npm_package_version || '1.0.0',
  buildTime: process.env.BUILD_TIME || null,

  jwtSecret: process.env.JWT_SECRET || 'mediahub-local-secret',
  jwtSecretIsDefault: !process.env.JWT_SECRET,

  databaseUrl: process.env.DATABASE_URL || '',

  r2: {
    accountId: process.env.R2_ACCOUNT_ID || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    bucketName: process.env.R2_BUCKET_NAME || '',
    endpoint: process.env.R2_ENDPOINT || '',
  },

  smtp: {
    // Phase B.2 - real owner-notification emails (account health failover,
    // token-expiring-soon). Requires host+user+password; port/from/secure
    // have sane defaults so only credentials need setting to go live.
    configured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD),
    host: process.env.SMTP_HOST || null,
    port: int(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER || null,
    password: process.env.SMTP_PASSWORD || null,
    from: process.env.SMTP_FROM || 'MediaHub <no-reply@mediahub.local>',
    secure: bool(process.env.SMTP_SECURE, false),
  },

  meta: {
    configured: Boolean(process.env.WHATSAPP_APP_SECRET),
    // Phase B.1 - Meta Embedded Signup. appId and configId are public
    // identifiers (safe to hand to the frontend, like a Stripe publishable
    // key); appSecret reuses the existing WHATSAPP_APP_SECRET rather than
    // introducing a second app-secret env var, since a Meta app has exactly
    // one secret used for both webhook signature verification and OAuth
    // code exchange.
    appId: process.env.META_APP_ID || '',
    appSecret: process.env.WHATSAPP_APP_SECRET || '',
    configId: process.env.META_WHATSAPP_CONFIG_ID || '',
    graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION || 'v20.0',
    embeddedSignupConfigured: Boolean(
      process.env.META_APP_ID && process.env.WHATSAPP_APP_SECRET && process.env.META_WHATSAPP_CONFIG_ID,
    ),
  },

  redis: {
    configured: Boolean(process.env.REDIS_URL),
    url: process.env.REDIS_URL || null,
  },

  cors: {
    // Comma-separated allowlist. Unset keeps the existing reflect-any-origin
    // behavior (required today: no fixed frontend origin is configured) -
    // set this in production to lock CORS down without code changes.
    allowedOrigins: (process.env.CORS_ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean),
  },

  rateLimit: {
    windowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: int(process.env.RATE_LIMIT_MAX, 300),
    authWindowMs: int(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    authMax: int(process.env.AUTH_RATE_LIMIT_MAX, 20),
  },

  bruteForce: {
    maxFailedAttempts: int(process.env.BRUTE_FORCE_MAX_ATTEMPTS, 5),
    lockoutMs: int(process.env.BRUTE_FORCE_LOCKOUT_MS, 15 * 60 * 1000),
  },

  requestBodyLimit: process.env.REQUEST_BODY_LIMIT || '2mb',

  trustProxy: bool(process.env.TRUST_PROXY, true),

  // Phase B.4 - Webhook Automation & Delivery Reliability. Retry ladder is a
  // fixed shape (1m/5m/15m/1h, per the brief) - only how many rungs of it get
  // used before dead-lettering is configurable, via maxRetryAttempts.
  webhook: {
    maxRetryAttempts: int(process.env.WEBHOOK_MAX_RETRY_ATTEMPTS, 4),
    retryLadderMs: [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000],
    reconcileStaleMs: int(process.env.WEBHOOK_RECONCILE_STALE_MINUTES, 120) * 60_000,
    reconcileIntervalMs: int(process.env.WEBHOOK_RECONCILE_INTERVAL_MINUTES, 15) * 60_000,
    eventRetentionDays: int(process.env.WEBHOOK_EVENT_RETENTION_DAYS, 30),
    offlineAlertMs: int(process.env.WEBHOOK_OFFLINE_ALERT_MINUTES, 120) * 60_000,
    signatureFailureAlertThreshold: int(process.env.WEBHOOK_SIGNATURE_FAILURE_ALERT_THRESHOLD, 5),
    deadLetterAlertThreshold: int(process.env.WEBHOOK_DEAD_LETTER_ALERT_THRESHOLD, 5),
    retryFailureAlertThreshold: int(process.env.WEBHOOK_RETRY_FAILURE_ALERT_THRESHOLD, 10),
  },
} as const;

export type AppConfig = typeof config;

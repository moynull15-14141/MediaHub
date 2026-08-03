// Lightweight structured logger (Phase A.4, Part 13). Deliberately not a
// Winston/Pino dependency - a lot of ceremony for what this app needs, which
// is JSON lines with a level/timestamp/context on stdout (Docker's log
// driver and any hosting platform's log aggregator already handle capture
// and shipping). Used by all NEW code in this phase; the ~50 existing
// console.log/console.error call sites across working controllers are left
// as-is (migrating every one is a separate follow-up, not part of this pass).

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogFields {
  [key: string]: unknown;
}

const write = (level: LogLevel, category: string, message: string, fields?: LogFields) => {
  const line = {
    timestamp: new Date().toISOString(),
    level,
    category,
    message,
    ...(fields && Object.keys(fields).length > 0 ? { fields } : {}),
  };
  const serialized = JSON.stringify(line);
  if (level === 'error') console.error(serialized);
  else if (level === 'warn') console.warn(serialized);
  else console.log(serialized);
};

const makeLogger = (category: string) => ({
  info: (message: string, fields?: LogFields) => write('info', category, message, fields),
  warn: (message: string, fields?: LogFields) => write('warn', category, message, fields),
  error: (message: string, fields?: LogFields) => write('error', category, message, fields),
  debug: (message: string, fields?: LogFields) => write('debug', category, message, fields),
});

export const appLogger = makeLogger('app');
export const requestLogger = makeLogger('request');
export const errorLogger = makeLogger('error');
export const auditLogger = makeLogger('audit');
export const workerLogger = makeLogger('worker');
export const tokenLogger = makeLogger('token'); // Phase B.3 - token lifecycle state transitions

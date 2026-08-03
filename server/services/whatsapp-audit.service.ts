import { prisma } from '../lib/prisma';
import { getCurrentWorkspaceForUser } from './workspace.service';

const DETAIL_MAX = 500;

// Fire-and-forget-safe: audit logging should never fail the action it's
// describing, so failures here are swallowed (and logged to the console)
// rather than thrown. Resolves workspaceId from userId internally (rather
// than threading it through every one of this function's ~13 call sites)
// since every user currently belongs to exactly one workspace.
export const logAudit = async (userId: string, action: string, detail?: string): Promise<void> => {
  try {
    const member = await getCurrentWorkspaceForUser(userId);
    if (!member) return;
    await prisma.accountAuditLog.create({
      data: { userId, workspaceId: member.workspaceId, action, detail: detail ? detail.slice(0, DETAIL_MAX) : undefined },
    });
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
};

export interface ListAuditLogsOptions {
  page?: number;
  pageSize?: number;
}

export const listAuditLogs = async (userId: string, options: ListAuditLogsOptions) => {
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 25));

  const [logs, total] = await Promise.all([
    prisma.accountAuditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.accountAuditLog.count({ where: { userId } }),
  ]);

  return { logs, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

// Phase B.3 - GET /account/health-history. Deliberately reads from the
// existing audit trail rather than a second stored "healthHistory" JSON
// column - every lifecycle event (TOKEN_*, ACCOUNT_VALIDATED, AUTO_PAUSE,
// AUTO_RESUME) is already durably recorded here, so a second copy would only
// ever be able to drift from this one.
const LIFECYCLE_ACTIONS = [
  'TOKEN_VALIDATED', 'TOKEN_EXPIRED', 'TOKEN_INVALID', 'TOKEN_RECONNECTED',
  'TOKEN_PERMISSION_REVOKED', 'TOKEN_RECONNECT_REQUIRED', 'TOKEN_VALIDATION_RATE_LIMITED',
  'TOKEN_LIFECYCLE_NOTIFICATION', 'ACCOUNT_VALIDATED', 'AUTO_PAUSE', 'AUTO_RESUME',
  'CAMPAIGN_AUTO_PAUSED', 'CAMPAIGN_AUTO_RESUMED',
];

export const listHealthHistory = async (userId: string, options: ListAuditLogsOptions) => {
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 25));

  const where = { userId, action: { in: LIFECYCLE_ACTIONS } };
  const [logs, total] = await Promise.all([
    prisma.accountAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.accountAuditLog.count({ where }),
  ]);

  return { logs, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

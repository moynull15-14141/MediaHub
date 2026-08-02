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

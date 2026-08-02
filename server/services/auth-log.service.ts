import { Request } from 'express';
import { prisma } from '../lib/prisma';
import { getClientIp, getDeviceInfo, getBrowser } from '../lib/request-info';
import { auditLogger } from '../lib/logger';

type AuthEventType = 'LOGIN' | 'LOGIN_FAILED' | 'LOGOUT' | 'LOGOUT_ALL' | 'TOKEN_REFRESH' | 'PASSWORD_CHANGE' | 'REGISTER';

// Fire-and-forget-safe, same convention as logAudit in whatsapp-audit.service.ts -
// auth logging should never fail (or slow down) the login/logout it describes.
export const recordAuthEvent = async (
  req: Request,
  event: AuthEventType,
  email: string,
  userId?: string,
  reason?: string,
): Promise<void> => {
  try {
    const { deviceType, platform } = getDeviceInfo(req);
    await prisma.authEvent.create({
      data: {
        userId,
        email: email.toLowerCase(),
        event,
        ipAddress: getClientIp(req),
        userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
        deviceType,
        os: platform,
        browser: getBrowser(req),
        reason,
      },
    });
    auditLogger.info(event, { email, userId, ip: getClientIp(req) });
  } catch (err) {
    auditLogger.error('Failed to record auth event', { event, email, error: String(err) });
  }
};

// Brute Force Protection (Phase A.4, Part 5) - counts LOGIN_FAILED events for
// this email within the lockout window. DB-backed rather than in-memory so
// it survives a container restart and works correctly with multiple app
// instances behind a load balancer, unlike a plain in-process Map.
export const isLockedOut = async (email: string, maxAttempts: number, lockoutMs: number): Promise<boolean> => {
  const since = new Date(Date.now() - lockoutMs);
  const recentFailures = await prisma.authEvent.count({
    where: { email: email.toLowerCase(), event: 'LOGIN_FAILED', createdAt: { gte: since } },
  });
  return recentFailures >= maxAttempts;
};

export const listLoginHistory = async (userId: string, limit = 20) => {
  return prisma.authEvent.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(100, Math.max(1, limit)),
  });
};

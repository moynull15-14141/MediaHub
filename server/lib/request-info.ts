import { Request } from 'express';

// Relocated from media.controller.ts (was a locally-duplicated pair there) so
// auth-log.service.ts and any future caller share one implementation instead
// of re-deriving IP/device parsing per file.
export const getClientIp = (req: Request): string => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
};

export const getDeviceInfo = (req: Request): { deviceType: string; platform: string } => {
  const ua = String(req.headers['user-agent'] || '');
  const lower = ua.toLowerCase();
  if (/mobile|iphone|ipod|android/i.test(lower)) return { deviceType: 'Mobile', platform: /iphone|ipad|ipod/i.test(lower) ? 'iOS' : 'Android' };
  if (/tablet/i.test(lower)) return { deviceType: 'Tablet', platform: /ipad/i.test(lower) ? 'iOS' : 'Tablet' };
  if (/windows/i.test(lower)) return { deviceType: 'Desktop', platform: 'Windows' };
  if (/macintosh|mac os x/i.test(lower)) return { deviceType: 'Desktop', platform: 'Mac' };
  if (/linux/i.test(lower)) return { deviceType: 'Desktop', platform: 'Linux' };
  return { deviceType: 'Desktop', platform: 'Unknown' };
};

const BROWSER_PATTERNS: [RegExp, string][] = [
  [/edg\//i, 'Edge'],
  [/chrome\//i, 'Chrome'],
  [/firefox\//i, 'Firefox'],
  [/safari\//i, 'Safari'],
];

export const getBrowser = (req: Request): string => {
  const ua = String(req.headers['user-agent'] || '');
  for (const [pattern, name] of BROWSER_PATTERNS) {
    if (pattern.test(ua)) return name;
  }
  return 'Unknown';
};

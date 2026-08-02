import Papa from 'papaparse';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { prisma } from '../lib/prisma';
import { sanitizeText } from './contact.service';
import { logAudit } from './whatsapp-audit.service';

export class BlacklistError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const REASONS = ['BLOCKED', 'UNSUBSCRIBED', 'INVALID', 'FAILED'] as const;
const NOTE_MAX = 300;

// Blacklist entries are preventive, so normalization is deliberately lenient
// (unlike Contact creation, which rejects unparseable numbers outright) -
// missing an entry because of a formatting quirk is worse than storing an
// imperfectly-normalized one.
export const normalizeBlacklistPhone = (raw: string): string => {
  const trimmed = raw.trim();
  const withPlus = trimmed.startsWith('+') ? trimmed : `+${trimmed.replace(/[^0-9]/g, '')}`;
  const parsed = parsePhoneNumberFromString(withPlus);
  if (parsed && parsed.isValid()) return parsed.number;
  return withPlus.replace(/[^0-9+]/g, '').slice(0, 20);
};

const toPublicEntry = (entry: any) => ({
  id: entry.id,
  phoneNumber: entry.phoneNumber,
  reason: entry.reason,
  note: entry.note,
  createdAt: entry.createdAt,
});

export interface ListBlacklistOptions {
  search?: string;
  reason?: string;
  page?: number;
  pageSize?: number;
}

export const listBlacklist = async (workspaceId: string, options: ListBlacklistOptions) => {
  if (options.reason && !REASONS.includes(options.reason as any)) {
    throw new BlacklistError(`Invalid reason filter: ${options.reason}`, 400);
  }
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(options.pageSize) || 25));

  const where: any = { workspaceId };
  if (options.search?.trim()) where.phoneNumber = { contains: options.search.trim() };
  if (options.reason) where.reason = options.reason;

  const [entries, total] = await Promise.all([
    prisma.blacklistedNumber.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.blacklistedNumber.count({ where }),
  ]);

  return {
    entries: entries.map(toPublicEntry),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
};

export const addToBlacklist = async (workspaceId: string, userId: string, body: any) => {
  const phoneNumberRaw = typeof body?.phoneNumber === 'string' ? body.phoneNumber : '';
  if (!phoneNumberRaw.trim()) throw new BlacklistError('Phone number is required', 400);
  const reason = typeof body?.reason === 'string' && REASONS.includes(body.reason) ? body.reason : 'BLOCKED';
  const note = sanitizeText(body?.note, NOTE_MAX);
  const phoneNumber = normalizeBlacklistPhone(phoneNumberRaw);

  const entry = await prisma.blacklistedNumber.upsert({
    where: { workspaceId_phoneNumber: { workspaceId, phoneNumber } },
    create: { workspaceId, userId, phoneNumber, reason, note },
    update: { reason, note },
  });
  return toPublicEntry(entry);
};

export const bulkDelete = async (workspaceId: string, ids: unknown) => {
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) {
    throw new BlacklistError('ids must be a non-empty array', 400);
  }
  const result = await prisma.blacklistedNumber.deleteMany({ where: { workspaceId, id: { in: ids } } });
  return { deletedCount: result.count };
};

export const deleteOne = async (workspaceId: string, id: string) => {
  const entry = await prisma.blacklistedNumber.findUnique({ where: { id } });
  if (!entry || entry.workspaceId !== workspaceId) throw new BlacklistError('Entry not found', 404);
  await prisma.blacklistedNumber.delete({ where: { id } });
};

const MAX_IMPORT_ROWS = 20000;

export const importCsv = async (workspaceId: string, userId: string, buffer: Buffer) => {
  const text = buffer.toString('utf8');
  const parsed = Papa.parse<Record<string, any>>(text, { header: true, skipEmptyLines: true });
  const rows = parsed.data.slice(0, MAX_IMPORT_ROWS);

  let imported = 0;
  let skipped = 0;
  for (const row of rows) {
    const rawPhone = row.phoneNumber || row.phone || row.Phone || row['Phone Number'] || row.number || '';
    if (!String(rawPhone).trim()) {
      skipped += 1;
      continue;
    }
    const phoneNumber = normalizeBlacklistPhone(String(rawPhone));
    const rawReason = String(row.reason || row.Reason || 'BLOCKED').toUpperCase();
    const reason = REASONS.includes(rawReason as any) ? rawReason : 'BLOCKED';
    const note = sanitizeText(row.note || row.Note, NOTE_MAX);

    await prisma.blacklistedNumber.upsert({
      where: { workspaceId_phoneNumber: { workspaceId, phoneNumber } },
      create: { workspaceId, userId, phoneNumber, reason: reason as any, note },
      update: { reason: reason as any, note },
    });
    imported += 1;
  }

  await logAudit(userId, 'BLACKLIST_IMPORTED', `${imported} imported, ${skipped} skipped`);
  return { imported, skipped, total: rows.length };
};

const csvEscape = (value: string): string => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

export const exportCsv = async (workspaceId: string): Promise<string> => {
  const entries = await prisma.blacklistedNumber.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' } });
  const header = 'phoneNumber,reason,note,createdAt';
  const rows = entries.map((e) =>
    [e.phoneNumber, e.reason, e.note || '', e.createdAt.toISOString()].map((v) => csvEscape(String(v))).join(','),
  );
  return [header, ...rows].join('\n');
};

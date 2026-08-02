import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { parsePhoneNumberFromString, CountryCode } from 'libphonenumber-js';
import { prisma } from '../lib/prisma';
import { sanitizeText, CUSTOM_FIELD_KEY_MAX, CUSTOM_FIELD_VALUE_MAX, CUSTOM_FIELD_MAX_COUNT, CUSTOM_FIELD_KEY_PATTERN } from './contact.service';

export class ContactImportError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const MAX_ROWS = 20000;
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_PATTERN = new RegExp('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]');
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

export type ImportRowStatus = 'valid' | 'duplicate' | 'invalid' | 'skipped';

export interface ImportRow {
  rowNumber: number;
  name: string;
  phoneNumber: string;
  countryCode: string;
  email?: string;
  company?: string;
  notes?: string;
  customFields?: Record<string, string>;
  status: ImportRowStatus;
  reason?: string;
  normalizedPhone?: string;
}

export interface ImportPreview {
  rows: ImportRow[];
  summary: { total: number; valid: number; duplicate: number; invalid: number; skipped: number };
}

const HEADER_ALIASES: Record<string, keyof Pick<ImportRow, 'name' | 'phoneNumber' | 'countryCode' | 'email' | 'company' | 'notes'>> = {
  name: 'name',
  fullname: 'name',
  'full name': 'name',
  phone: 'phoneNumber',
  phonenumber: 'phoneNumber',
  'phone number': 'phoneNumber',
  mobile: 'phoneNumber',
  countrycode: 'countryCode',
  'country code': 'countryCode',
  country: 'countryCode',
  email: 'email',
  'e-mail': 'email',
  company: 'company',
  organization: 'company',
  notes: 'notes',
  note: 'notes',
};

// Any CSV/XLSX column that isn't one of the known contact fields
// automatically becomes a custom field (and, downstream, a {{variable}}) -
// nothing about the import is dropped, no manual column mapping needed.
const normalizeHeaderRow = (rawRows: Record<string, any>[]): Record<string, any>[] => {
  return rawRows.map((raw) => {
    const row: Record<string, any> = {};
    const customFields: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      const normalizedKey = HEADER_ALIASES[key.trim().toLowerCase()];
      if (normalizedKey) {
        row[normalizedKey] = value;
        continue;
      }
      const trimmedValue = value === undefined || value === null ? '' : String(value).trim();
      const trimmedKey = key.trim().slice(0, CUSTOM_FIELD_KEY_MAX);
      if (!trimmedValue || !trimmedKey || !CUSTOM_FIELD_KEY_PATTERN.test(trimmedKey)) continue;
      if (Object.keys(customFields).length >= CUSTOM_FIELD_MAX_COUNT) continue;
      customFields[trimmedKey] = trimmedValue.slice(0, CUSTOM_FIELD_VALUE_MAX);
    }
    if (Object.keys(customFields).length > 0) row.customFields = customFields;
    return row;
  });
};

export const parseImportFile = (buffer: Buffer, filename: string): { source: 'CSV' | 'XLSX'; rows: Record<string, any>[] } => {
  const ext = filename.toLowerCase().split('.').pop();

  if (ext === 'csv') {
    const text = buffer.toString('utf8');
    const parsed = Papa.parse<Record<string, any>>(text, { header: true, skipEmptyLines: false });
    if (parsed.errors?.length) {
      const fatal = parsed.errors.find((e) => e.type === 'Delimiter' || e.type === 'Quotes');
      if (fatal) throw new ContactImportError(`Failed to parse CSV: ${fatal.message}`, 400);
    }
    return { source: 'CSV', rows: normalizeHeaderRow(parsed.data) };
  }

  if (ext === 'xlsx' || ext === 'xls') {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new ContactImportError('The spreadsheet has no sheets', 400);
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });
    return { source: 'XLSX', rows: normalizeHeaderRow(rows) };
  }

  throw new ContactImportError('Unsupported file type. Upload a .csv or .xlsx file.', 400);
};

const isRowEmpty = (row: Record<string, any>): boolean =>
  Object.values(row).every((v) => v === undefined || v === null || String(v).trim() === '');

const hasInvalidCharacters = (value: string | undefined): boolean =>
  typeof value === 'string' && CONTROL_CHAR_PATTERN.test(value);

export const validateRows = async (workspaceId: string, rawRows: Record<string, any>[]): Promise<ImportPreview> => {
  if (rawRows.length > MAX_ROWS) {
    throw new ContactImportError(`Too many rows: ${rawRows.length}. Maximum is ${MAX_ROWS}.`, 400);
  }

  const rows: ImportRow[] = [];
  const seenInFile = new Set<string>();

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i];
    const rowNumber = i + 2; // account for the header row

    if (isRowEmpty(raw)) {
      rows.push({ rowNumber, name: '', phoneNumber: '', countryCode: '', status: 'skipped', reason: 'Empty row' });
      continue;
    }

    const name = sanitizeText(raw.name, 150) || '';
    const rawPhone = typeof raw.phoneNumber === 'string' ? raw.phoneNumber.trim() : String(raw.phoneNumber ?? '').trim();
    const rawCountry = typeof raw.countryCode === 'string' ? raw.countryCode.trim().toUpperCase() : '';
    const email = sanitizeText(raw.email, 254);
    const company = sanitizeText(raw.company, 150);
    const notes = sanitizeText(raw.notes, 2000);
    const customFields = raw.customFields as Record<string, string> | undefined;

    if ([raw.name, raw.company, raw.notes].some((v) => hasInvalidCharacters(typeof v === 'string' ? v : undefined))) {
      rows.push({ rowNumber, name, phoneNumber: rawPhone, countryCode: rawCountry, email, company, notes, status: 'invalid', reason: 'Contains invalid control characters' });
      continue;
    }
    if (!name) {
      rows.push({ rowNumber, name, phoneNumber: rawPhone, countryCode: rawCountry, email, company, notes, status: 'invalid', reason: 'Missing name' });
      continue;
    }
    if (!rawPhone) {
      rows.push({ rowNumber, name, phoneNumber: rawPhone, countryCode: rawCountry, email, company, notes, status: 'invalid', reason: 'Missing phone number' });
      continue;
    }
    if (!rawCountry || !COUNTRY_CODE_PATTERN.test(rawCountry)) {
      rows.push({ rowNumber, name, phoneNumber: rawPhone, countryCode: rawCountry, email, company, notes, status: 'invalid', reason: 'Missing or invalid country code (use a 2-letter ISO code)' });
      continue;
    }

    const parsed = parsePhoneNumberFromString(rawPhone, rawCountry as CountryCode);
    if (!parsed || !parsed.isValid()) {
      rows.push({ rowNumber, name, phoneNumber: rawPhone, countryCode: rawCountry, email, company, notes, status: 'invalid', reason: 'Invalid phone number' });
      continue;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      rows.push({ rowNumber, name, phoneNumber: rawPhone, countryCode: rawCountry, email, company, notes, status: 'invalid', reason: 'Invalid email address' });
      continue;
    }

    const normalizedPhone = parsed.number;
    if (seenInFile.has(normalizedPhone)) {
      rows.push({ rowNumber, name, phoneNumber: rawPhone, countryCode: rawCountry, email, company, notes, status: 'duplicate', reason: 'Duplicate phone number within this file', normalizedPhone });
      continue;
    }
    seenInFile.add(normalizedPhone);

    rows.push({ rowNumber, name, phoneNumber: rawPhone, countryCode: rawCountry, email, company, notes, customFields, status: 'valid', normalizedPhone });
  }

  const candidatePhones = rows.filter((r) => r.status === 'valid').map((r) => r.normalizedPhone!) ;
  if (candidatePhones.length > 0) {
    const existing = await prisma.contact.findMany({
      where: { workspaceId, phoneNumber: { in: candidatePhones } },
      select: { phoneNumber: true },
    });
    const existingSet = new Set(existing.map((c) => c.phoneNumber));
    for (const row of rows) {
      if (row.status === 'valid' && row.normalizedPhone && existingSet.has(row.normalizedPhone)) {
        row.status = 'duplicate';
        row.reason = 'Already exists in your contacts';
      }
    }
  }

  const summary = {
    total: rows.length,
    valid: rows.filter((r) => r.status === 'valid').length,
    duplicate: rows.filter((r) => r.status === 'duplicate').length,
    invalid: rows.filter((r) => r.status === 'invalid').length,
    skipped: rows.filter((r) => r.status === 'skipped').length,
  };

  return { rows, summary };
};

export interface CommitImportResult {
  importedCount: number;
  duplicateCount: number;
  invalidCount: number;
  skippedCount: number;
  totalRows: number;
}

export const commitImport = async (
  workspaceId: string,
  userId: string,
  rows: ImportRow[],
  meta: { filename?: string; source: 'CSV' | 'XLSX' },
): Promise<CommitImportResult> => {
  const validRows = rows.filter((r) => r.status === 'valid' && r.normalizedPhone);
  if (validRows.length === 0) {
    throw new ContactImportError('No valid rows to import', 400);
  }

  // Re-check against the DB at commit time to avoid a race with concurrent imports.
  const existing = await prisma.contact.findMany({
    where: { workspaceId, phoneNumber: { in: validRows.map((r) => r.normalizedPhone!) } },
    select: { phoneNumber: true },
  });
  const existingSet = new Set(existing.map((c) => c.phoneNumber));
  const toInsert = validRows.filter((r) => !existingSet.has(r.normalizedPhone!));
  const raceDuplicates = validRows.length - toInsert.length;

  if (toInsert.length > 0) {
    await prisma.contact.createMany({
      data: toInsert.map((r) => ({
        workspaceId,
        userId,
        name: r.name,
        phoneNumber: r.normalizedPhone!,
        countryCode: r.countryCode,
        email: r.email || null,
        company: r.company || null,
        customFields: r.customFields ?? {},
        notes: r.notes || null,
        status: 'ACTIVE',
      })),
      skipDuplicates: true,
    });
  }

  const result: CommitImportResult = {
    importedCount: toInsert.length,
    duplicateCount: rows.filter((r) => r.status === 'duplicate').length + raceDuplicates,
    invalidCount: rows.filter((r) => r.status === 'invalid').length,
    skippedCount: rows.filter((r) => r.status === 'skipped').length,
    totalRows: rows.length,
  };

  await prisma.contactImportBatch.create({
    data: {
      workspaceId,
      userId,
      filename: meta.filename,
      source: meta.source,
      totalRows: result.totalRows,
      importedCount: result.importedCount,
      duplicateCount: result.duplicateCount,
      invalidCount: result.invalidCount,
      skippedCount: result.skippedCount,
    },
  });

  return result;
};

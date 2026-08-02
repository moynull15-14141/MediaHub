import { prisma } from '../lib/prisma';
import { parsePhoneNumberFromString, CountryCode } from 'libphonenumber-js';

export class ContactError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const NAME_MAX = 150;
const EMAIL_MAX = 254;
const COMPANY_MAX = 150;
const CITY_MAX = 100;
const COUNTRY_MAX = 100;
const NOTES_MAX = 2000;
export const CUSTOM_FIELD_KEY_MAX = 60;
export const CUSTOM_FIELD_VALUE_MAX = 500;
export const CUSTOM_FIELD_MAX_COUNT = 50;
export const CUSTOM_FIELD_KEY_PATTERN = /^[\w -]+$/;
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Strips characters that have no business being in a name/company field:
// control chars and anything that isn't letters/digits/common punctuation.
const CONTROL_CHAR_PATTERN = new RegExp('[\x00-\x1F\x7F]', 'g');

export const sanitizeText = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(CONTROL_CHAR_PATTERN, '').trim();
  return cleaned.slice(0, maxLength);
};

export const normalizePhoneNumber = (
  phoneNumber: string,
  countryCode: string,
): { e164: string; countryCode: string } => {
  const cc = countryCode.toUpperCase();
  if (!COUNTRY_CODE_PATTERN.test(cc)) {
    throw new ContactError(`Invalid country code: ${countryCode}. Use a 2-letter ISO code (e.g. BD, US).`, 400);
  }
  const parsed = parsePhoneNumberFromString(phoneNumber, cc as CountryCode);
  if (!parsed || !parsed.isValid()) {
    throw new ContactError(`Invalid phone number: ${phoneNumber}`, 400);
  }
  return { e164: parsed.number, countryCode: cc };
};

const STATUSES = ['ACTIVE', 'INACTIVE', 'BLOCKED'] as const;

export const toPublicContact = (contact: any) => ({
  id: contact.id,
  name: contact.name,
  phoneNumber: contact.phoneNumber,
  countryCode: contact.countryCode,
  email: contact.email,
  company: contact.company,
  city: contact.city,
  country: contact.country,
  customFields: (contact.customFields as Record<string, string> | null) ?? {},
  notes: contact.notes,
  status: contact.status,
  createdAt: contact.createdAt,
  updatedAt: contact.updatedAt,
  labels: contact.labels?.map((l: any) => l.label) ?? undefined,
  groups: contact.groups?.map((g: any) => g.group) ?? undefined,
});

export interface ContactInput {
  name: string;
  phoneNumber: string;
  countryCode: string;
  email?: string;
  company?: string;
  city?: string;
  country?: string;
  customFields?: Record<string, string>;
  notes?: string;
  status?: string;
}

// Contacts now carry unlimited free-form custom fields (from CSV columns or
// manual entry) that the template engine turns into {{variables}}. Keys and
// values are capped/sanitized here so a malicious or malformed import can't
// blow up storage or downstream rendering.
const validateCustomFields = (value: unknown): Record<string, string> | undefined => {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContactError('customFields must be an object', 400);
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > CUSTOM_FIELD_MAX_COUNT) {
    throw new ContactError(`customFields supports at most ${CUSTOM_FIELD_MAX_COUNT} keys`, 400);
  }
  const result: Record<string, string> = {};
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.trim().slice(0, CUSTOM_FIELD_KEY_MAX);
    if (!key || !CUSTOM_FIELD_KEY_PATTERN.test(key)) {
      throw new ContactError(`Invalid custom field name: ${rawKey}`, 400);
    }
    const stringValue = rawValue === null || rawValue === undefined ? '' : String(rawValue);
    result[key] = (sanitizeText(stringValue, CUSTOM_FIELD_VALUE_MAX) ?? '').slice(0, CUSTOM_FIELD_VALUE_MAX);
  }
  return result;
};

const validateContactInput = (body: any, requireAll: boolean): Partial<ContactInput> => {
  const result: Partial<ContactInput> = {};

  if (body?.name !== undefined || requireAll) {
    const name = sanitizeText(body?.name, NAME_MAX);
    if (!name) throw new ContactError('Name is required', 400);
    result.name = name;
  }
  if (body?.phoneNumber !== undefined || requireAll) {
    if (typeof body?.phoneNumber !== 'string' || !body.phoneNumber.trim()) {
      throw new ContactError('Phone number is required', 400);
    }
    result.phoneNumber = body.phoneNumber.trim();
  }
  if (body?.countryCode !== undefined || requireAll) {
    if (typeof body?.countryCode !== 'string' || !body.countryCode.trim()) {
      throw new ContactError('Country code is required', 400);
    }
    result.countryCode = body.countryCode.trim();
  }
  if (body?.email !== undefined) {
    const email = sanitizeText(body.email, EMAIL_MAX);
    if (email && !EMAIL_PATTERN.test(email)) throw new ContactError(`Invalid email: ${email}`, 400);
    result.email = email || undefined;
  }
  if (body?.company !== undefined) {
    result.company = sanitizeText(body.company, COMPANY_MAX);
  }
  if (body?.city !== undefined) {
    result.city = sanitizeText(body.city, CITY_MAX);
  }
  if (body?.country !== undefined) {
    result.country = sanitizeText(body.country, COUNTRY_MAX);
  }
  if (body?.customFields !== undefined) {
    result.customFields = validateCustomFields(body.customFields);
  }
  if (body?.notes !== undefined) {
    result.notes = sanitizeText(body.notes, NOTES_MAX);
  }
  if (body?.status !== undefined) {
    if (!STATUSES.includes(body.status)) throw new ContactError(`Invalid status: ${body.status}`, 400);
    result.status = body.status;
  }
  return result;
};

export interface ListContactsOptions {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  groupId?: string;
  labelId?: string;
}

export const listContacts = async (userId: string, options: ListContactsOptions) => {
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(options.pageSize) || 25));

  if (options.status && !STATUSES.includes(options.status as any)) {
    throw new ContactError(`Invalid status filter: ${options.status}`, 400);
  }

  const where: any = { userId };
  if (options.search) {
    const search = options.search.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phoneNumber: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { company: { contains: search, mode: 'insensitive' } },
      ];
    }
  }
  if (options.status) where.status = options.status;
  if (options.groupId) where.groups = { some: { groupId: options.groupId } };
  if (options.labelId) where.labels = { some: { labelId: options.labelId } };

  const [contacts, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      include: { labels: { include: { label: true } }, groups: { include: { group: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.contact.count({ where }),
  ]);

  return {
    contacts: contacts.map(toPublicContact),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
};

const findOwnedContact = async (contactId: string, userId: string) => {
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.userId !== userId) throw new ContactError('Contact not found', 404);
  return contact;
};

export const createContact = async (userId: string, body: any) => {
  const input = validateContactInput(body, true) as ContactInput;
  const { e164, countryCode } = normalizePhoneNumber(input.phoneNumber, input.countryCode);

  const existing = await prisma.contact.findUnique({ where: { userId_phoneNumber: { userId, phoneNumber: e164 } } });
  if (existing) throw new ContactError('A contact with this phone number already exists', 409);

  const contact = await prisma.contact.create({
    data: {
      userId,
      name: input.name,
      phoneNumber: e164,
      countryCode,
      email: input.email,
      company: input.company,
      city: input.city,
      country: input.country,
      customFields: input.customFields ?? {},
      notes: input.notes,
      status: (input.status as any) || 'ACTIVE',
    },
  });
  return toPublicContact(contact);
};

export const updateContact = async (userId: string, contactId: string, body: any) => {
  await findOwnedContact(contactId, userId);
  const input = validateContactInput(body, false);

  const data: any = { ...input };
  if (input.phoneNumber || input.countryCode) {
    const existing = await findOwnedContact(contactId, userId);
    const phoneNumber = input.phoneNumber ?? existing.phoneNumber;
    const countryCode = input.countryCode ?? existing.countryCode;
    const { e164, countryCode: normalizedCountry } = normalizePhoneNumber(phoneNumber, countryCode);
    const conflict = await prisma.contact.findUnique({ where: { userId_phoneNumber: { userId, phoneNumber: e164 } } });
    if (conflict && conflict.id !== contactId) {
      throw new ContactError('A contact with this phone number already exists', 409);
    }
    data.phoneNumber = e164;
    data.countryCode = normalizedCountry;
  }

  const contact = await prisma.contact.update({ where: { id: contactId }, data });
  return toPublicContact(contact);
};

export const deleteContact = async (userId: string, contactId: string) => {
  await findOwnedContact(contactId, userId);
  await prisma.contact.delete({ where: { id: contactId } });
};

export const bulkDeleteContacts = async (userId: string, ids: unknown) => {
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) {
    throw new ContactError('ids must be a non-empty array of contact IDs', 400);
  }
  const result = await prisma.contact.deleteMany({ where: { userId, id: { in: ids } } });
  return { deletedCount: result.count };
};

// Single source of truth for WhatsApp Campaign variable syntax, validation,
// and rendering. Every place that needs to parse/validate/render a message
// (campaign save-time checks, the Ready-status gate, the live preview
// endpoint, and — later — the Campaign Sender) goes through this module so
// the behavior never drifts between call sites.

import { prisma } from '../lib/prisma';

export const MAX_MESSAGE_LENGTH = 4096;

export const STANDARD_VARIABLE_KEYS = ['name', 'phone', 'company', 'email', 'city', 'country'] as const;

const VARIABLE_KEY_PATTERN = /^[A-Za-z0-9 _-]+$/;
const SNIPPET_MAX = 40;

export interface VariableToken {
  raw: string;
  key: string;
  start: number;
  end: number;
}

export interface MalformedEntry {
  snippet: string;
  reason: string;
}

const truncate = (s: string): string => (s.length > SNIPPET_MAX ? `${s.slice(0, SNIPPET_MAX)}…` : s);

// A small character scanner rather than a single regex, so structural errors
// (unterminated `{{`, stray `}}`, nesting) can be caught and reported
// individually instead of just silently failing to match.
export const scanVariableTokens = (message: string): { tokens: VariableToken[]; malformed: MalformedEntry[] } => {
  const tokens: VariableToken[] = [];
  const malformed: MalformedEntry[] = [];
  const len = message.length;
  let insideStart = -1;
  let i = 0;

  while (i < len) {
    if (message[i] === '{' && message[i + 1] === '{') {
      if (insideStart !== -1) {
        malformed.push({ snippet: truncate(message.slice(insideStart, i + 2)), reason: 'Nested variables are not supported' });
      }
      insideStart = i;
      i += 2;
      continue;
    }
    if (message[i] === '}' && message[i + 1] === '}') {
      if (insideStart === -1) {
        malformed.push({ snippet: truncate(message.slice(Math.max(0, i - SNIPPET_MAX + 2), i + 2)), reason: 'Missing {{' });
        i += 2;
        continue;
      }
      const raw = message.slice(insideStart, i + 2);
      const key = message.slice(insideStart + 2, i).trim();
      if (!key) {
        malformed.push({ snippet: raw, reason: 'Empty variable placeholder' });
      } else if (!VARIABLE_KEY_PATTERN.test(key)) {
        malformed.push({ snippet: truncate(raw), reason: 'Variable name contains unsupported characters' });
      } else {
        tokens.push({ raw, key, start: insideStart, end: i + 2 });
      }
      insideStart = -1;
      i += 2;
      continue;
    }
    i += 1;
  }

  if (insideStart !== -1) {
    malformed.push({ snippet: truncate(message.slice(insideStart)), reason: 'Missing }}' });
  }

  return { tokens, malformed };
};

// Fuzzy-matches a typed token against real field names regardless of
// spacing/case/separator style, so {{Due Date}}, {{due_date}}, and
// {{DueDate}} all resolve to the same underlying value.
export const normalizeVariableKey = (s: string): string => s.trim().toLowerCase().replace(/[\s_-]+/g, '');

export interface VariableEntry {
  originalKey: string;
  value: string;
}

export interface VariableContactShape {
  name: string;
  phoneNumber: string;
  company?: string | null;
  email?: string | null;
  city?: string | null;
  country?: string | null;
  customFields?: unknown;
}

export const getContactVariableMap = (contact: VariableContactShape): VariableEntry[] => {
  const entries: VariableEntry[] = [
    { originalKey: 'name', value: contact.name || '' },
    { originalKey: 'phone', value: contact.phoneNumber || '' },
    { originalKey: 'company', value: contact.company || '' },
    { originalKey: 'email', value: contact.email || '' },
    { originalKey: 'city', value: contact.city || '' },
    { originalKey: 'country', value: contact.country || '' },
  ];
  const custom = contact.customFields;
  if (custom && typeof custom === 'object' && !Array.isArray(custom)) {
    for (const [key, value] of Object.entries(custom as Record<string, unknown>)) {
      if (!key.trim()) continue;
      entries.push({ originalKey: key, value: value === null || value === undefined ? '' : String(value) });
    }
  }
  return entries;
};

export const levenshtein = (a: string, b: string): number => {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
};

export interface AvailableVariableKeys {
  standard: readonly string[];
  custom: string[];
}

const AVAILABLE_KEYS_CACHE_TTL_MS = 60_000;
const availableKeysCache = new Map<string, { standard: readonly string[]; custom: string[]; expiresAt: number }>();

// Aggregates every distinct customFields key across a workspace's contacts
// (plus the fixed standard fields) for the "Available Variables" panel and
// for unknown-variable validation. Cached in-process per workspace for a
// short TTL so bursts of keystroke-triggered preview calls don't each
// re-scan every contact - correctness only needs this to be
// eventually-consistent, since actual rendering always reads the live
// contact record, not this cache.
export const getAvailableVariableKeysCached = async (workspaceId: string): Promise<AvailableVariableKeys> => {
  const cached = availableKeysCache.get(workspaceId);
  if (cached && cached.expiresAt > Date.now()) {
    return { standard: cached.standard, custom: cached.custom };
  }

  const contacts = await prisma.contact.findMany({ where: { workspaceId }, select: { customFields: true } });
  const customKeys = new Map<string, string>();
  for (const contact of contacts) {
    const fields = contact.customFields;
    if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
      for (const key of Object.keys(fields as Record<string, unknown>)) {
        const normalized = normalizeVariableKey(key);
        if (normalized && !customKeys.has(normalized)) customKeys.set(normalized, key);
      }
    }
  }

  const result: AvailableVariableKeys = { standard: STANDARD_VARIABLE_KEYS, custom: Array.from(customKeys.values()) };
  availableKeysCache.set(workspaceId, { ...result, expiresAt: Date.now() + AVAILABLE_KEYS_CACHE_TTL_MS });
  return result;
};

export interface TemplateVariableStatus {
  token: string;
  key: string;
  normalizedKey: string;
  status: 'valid' | 'unknown';
  suggestion?: string;
}

export interface TemplateValidationResult {
  variables: TemplateVariableStatus[];
  duplicates: string[];
  malformed: MalformedEntry[];
  isValid: boolean;
}

export const validateTemplate = (message: string, availableKeys: AvailableVariableKeys): TemplateValidationResult => {
  const { tokens, malformed } = scanVariableTokens(message);

  const normalizedLookup = new Map<string, string>();
  for (const k of [...availableKeys.standard, ...availableKeys.custom]) {
    normalizedLookup.set(normalizeVariableKey(k), k);
  }

  const seen = new Set<string>();
  const duplicateSet = new Set<string>();

  const variables: TemplateVariableStatus[] = tokens.map((t) => {
    const normalizedKey = normalizeVariableKey(t.key);
    if (seen.has(normalizedKey)) duplicateSet.add(t.key);
    seen.add(normalizedKey);

    if (normalizedLookup.has(normalizedKey)) {
      return { token: t.raw, key: t.key, normalizedKey, status: 'valid' };
    }

    let bestKey: string | undefined;
    let bestDistance = Infinity;
    for (const [norm, original] of normalizedLookup) {
      const d = levenshtein(normalizedKey, norm);
      if (d < bestDistance) {
        bestDistance = d;
        bestKey = original;
      }
    }
    return { token: t.raw, key: t.key, normalizedKey, status: 'unknown', suggestion: bestKey && bestDistance <= 2 ? bestKey : undefined };
  });

  const isValid = malformed.length === 0 && variables.every((v) => v.status === 'valid');
  return { variables, duplicates: Array.from(duplicateSet), malformed, isValid };
};

// Strips control characters and literal braces from a substituted value so a
// contact's own data can never re-trigger variable parsing or corrupt the
// rendered message's structure (the "escape unsafe values" requirement).
// eslint-disable-next-line no-control-regex
const UNSAFE_VALUE_PATTERN = new RegExp('[\\x00-\\x1F\\x7F{}]', 'g');
const MAX_SUBSTITUTION_LENGTH = 1000;

const sanitizeSubstitutionValue = (value: string): string => value.replace(UNSAFE_VALUE_PATTERN, '').slice(0, MAX_SUBSTITUTION_LENGTH);

// Unresolved/unknown tokens are left untouched in the output (visibly
// obvious in a preview) rather than silently dropped.
export const renderTemplate = (message: string, contact: VariableContactShape): string => {
  const { tokens } = scanVariableTokens(message);
  if (tokens.length === 0) return message;

  const lookup = new Map<string, string>();
  for (const entry of getContactVariableMap(contact)) {
    const norm = normalizeVariableKey(entry.originalKey);
    if (!lookup.has(norm)) lookup.set(norm, sanitizeSubstitutionValue(entry.value));
  }

  let result = '';
  let cursor = 0;
  for (const token of tokens) {
    result += message.slice(cursor, token.start);
    const value = lookup.get(normalizeVariableKey(token.key));
    result += value !== undefined ? value : token.raw;
    cursor = token.end;
  }
  result += message.slice(cursor);
  return result;
};

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const usersFile = path.join(process.cwd(), 'server', 'data', 'users.json');
const cookiesDir = path.join(process.cwd(), 'server', 'data', 'cookies');
const jwtSecret = process.env.JWT_SECRET || 'mediahub-local-secret';
const tokenLifetimeSeconds = 60 * 60 * 24 * 7;

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
  cookiePath?: string;
  cookieUploadedAt?: string;
}

const ensureDataFiles = () => {
  if (!fs.existsSync(path.dirname(usersFile))) {
    fs.mkdirSync(path.dirname(usersFile), { recursive: true });
  }
  if (!fs.existsSync(usersFile)) {
    fs.writeFileSync(usersFile, '[]', 'utf8');
  }
  if (!fs.existsSync(cookiesDir)) {
    fs.mkdirSync(cookiesDir, { recursive: true });
  }
};

const base64Url = (value: string | Buffer) =>
  Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

const parseBase64Url = (value: string) =>
  Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

const hashPassword = (password: string, salt: string) => {
  return crypto.pbkdf2Sync(password, salt, 310000, 32, 'sha256').toString('hex');
};

const getTokenSignature = (header: string, payload: string) => {
  return base64Url(
    crypto.createHmac('sha256', jwtSecret).update(`${header}.${payload}`).digest()
  );
};

const loadUsers = (): UserRecord[] => {
  ensureDataFiles();
  const raw = fs.readFileSync(usersFile, 'utf8');
  try {
    return JSON.parse(raw) as UserRecord[];
  } catch {
    return [];
  }
};

const saveUsers = (users: UserRecord[]) => {
  ensureDataFiles();
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2), 'utf8');
};

export const findUserByEmail = (email: string): UserRecord | undefined => {
  const users = loadUsers();
  return users.find((user) => user.email.toLowerCase() === email.toLowerCase());
};

export const findUserById = (id: string): UserRecord | undefined => {
  const users = loadUsers();
  return users.find((user) => user.id === id);
};

export const registerUser = (email: string, password: string): UserRecord => {
  if (!email || !password) {
    throw new Error('Email and password are required.');
  }

  const existing = findUserByEmail(email);
  if (existing) {
    throw new Error('A user with that email already exists.');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  const newUser: UserRecord = {
    id: crypto.randomUUID(),
    email: email.toLowerCase(),
    passwordHash,
    salt,
    createdAt: new Date().toISOString(),
  };

  const users = loadUsers();
  users.push(newUser);
  saveUsers(users);
  return newUser;
};

export const verifyUserCredentials = (email: string, password: string): UserRecord | null => {
  const user = findUserByEmail(email);
  if (!user) return null;
  const computedHash = hashPassword(password, user.salt);
  return computedHash === user.passwordHash ? user : null;
};

export const createAuthToken = (user: UserRecord) => {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({ sub: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) + tokenLifetimeSeconds })
  );
  const signature = getTokenSignature(header, payload);
  return `${header}.${payload}.${signature}`;
};

export const verifyAuthToken = (token: string) => {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expected = getTokenSignature(header, payload);
  if (signature !== expected) return null;

  try {
    const parsed = JSON.parse(parseBase64Url(payload));
    if (typeof parsed.exp !== 'number' || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed as { sub: string; email: string; exp: number };
  } catch {
    return null;
  }
};

export const setUserCookies = (userId: string, rawCookieData: string) => {
  const users = loadUsers();
  const userIndex = users.findIndex((user) => user.id === userId);
  if (userIndex === -1) {
    throw new Error('User not found.');
  }

  if (!fs.existsSync(cookiesDir)) {
    fs.mkdirSync(cookiesDir, { recursive: true });
  }

  const cookiePath = path.join(cookiesDir, `${userId}.txt`);
  fs.writeFileSync(cookiePath, rawCookieData, 'utf8');
  users[userIndex].cookiePath = cookiePath;
  users[userIndex].cookieUploadedAt = new Date().toISOString();
  saveUsers(users);

  return cookiePath;
};
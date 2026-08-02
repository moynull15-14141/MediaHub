import crypto from 'crypto';

// AES-256-GCM encryption for the WhatsApp Business access token at rest.
// Stored as "iv:authTag:ciphertext" (all base64) in a single column so the
// token is never persisted in plaintext or serialized back to the client.
const ALGORITHM = 'aes-256-gcm';

const getKey = (): Buffer => {
  const raw = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('WHATSAPP_TOKEN_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('WHATSAPP_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded).');
  }
  return key;
};

export const encryptToken = (plainText: string): string => {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
};

export const decryptToken = (stored: string): string => {
  const key = getKey();
  const [ivB64, authTagB64, cipherTextB64] = stored.split(':');
  if (!ivB64 || !authTagB64 || !cipherTextB64) {
    throw new Error('Malformed encrypted token');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(cipherTextB64, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
};

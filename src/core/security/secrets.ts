/**
 * Symmetric encryption for integration credentials stored in the database.
 *
 * Every integration a tenant connects — Telegram bot token, IMAP password,
 * channel API key — is written to a per-tenant row, so it must be encrypted at
 * rest. This is the same AES-256-GCM scheme the bank-inbox module already used,
 * lifted out of it so integrations do not have to import from the finance
 * module to store a password.
 *
 * The key is infrastructure, not tenant data, so it legitimately lives in the
 * environment. BANK_INBOX_SECRET is accepted as a fallback so existing
 * deployments keep working without re-encrypting anything.
 */
import crypto from 'crypto';

function getKey(): Buffer {
  const hex = process.env.APP_SECRET_KEY || process.env.BANK_INBOX_SECRET;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'APP_SECRET_KEY must be 64 hex chars (32 bytes). Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return Buffer.from(hex, 'hex');
}

/** True when a usable key is configured — lets callers show a setup hint instead of throwing. */
export function secretsConfigured(): boolean {
  const hex = process.env.APP_SECRET_KEY || process.env.BANK_INBOX_SECRET;
  return !!hex && hex.length === 64;
}

/** Encrypt to `iv:tag:ciphertext`, all base64. */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

export function decryptSecret(encrypted: string): string {
  const [ivB, tagB, ctB] = encrypted.split(':');
  if (!ivB || !tagB || !ctB) throw new Error('Invalid encrypted payload format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8');
}

/** Show a credential without revealing it: "1234…7890". */
export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '•'.repeat(value.length);
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

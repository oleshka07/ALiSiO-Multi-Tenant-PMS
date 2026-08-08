/* eslint-disable @typescript-eslint/no-explicit-any */
// ════════════════════════════════════════════════════════════
// Finance step-up passphrase — data layer (synchronous better-sqlite3)
//
// Opt-in "second password" for the finance module:
//   - await hasFinancePassphrase(userId) === false  → finance is NOT locked
//     (owner-only access still applies). The owner can enable it.
//   - once set, the owner must unlock per session before reaching finance.
//
// The kdf_salt column is reserved for at-rest encryption (future phase): the
// passphrase will derive an encryption key; the verification hash here is
// independent of that key.
// ════════════════════════════════════════════════════════════
import { getDb } from '@/lib/db';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getSql } from '@core/db/async';

const UNLOCK_MINUTES = (() => {
  const n = Number(process.env.FINANCE_UNLOCK_MINUTES ?? '60');
  return Number.isFinite(n) && n > 0 ? n : 60;
})();

export async function hasFinancePassphrase(userId: string): Promise<boolean> {
  const sql = getSql();
  const row = await sql.row<any>('SELECT user_id FROM finance_security WHERE user_id = ?', [userId]);
  return !!row;
}

export async function setFinancePassphrase(userId: string, passphrase: string): Promise<void> {
  const sql = getSql();
  const hash = bcrypt.hashSync(passphrase, 12);
  const salt = crypto.randomBytes(16).toString('hex');
  await sql.run(`
    INSERT INTO finance_security (user_id, passphrase_hash, kdf_salt)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      passphrase_hash = excluded.passphrase_hash,
      updated_at = CURRENT_TIMESTAMP
  `, [userId, hash, salt]);
}

export async function verifyFinancePassphrase(userId: string, passphrase: string): Promise<boolean> {
  const sql = getSql();
  const row = await sql.row<any>('SELECT passphrase_hash FROM finance_security WHERE user_id = ?', [userId]) as { passphrase_hash: string } | undefined;
  if (!row) return false;
  return bcrypt.compareSync(passphrase, row.passphrase_hash);
}

export async function unlockFinance(sessionId: string): Promise<void> {
  const sql = getSql();
  const until = new Date(Date.now() + UNLOCK_MINUTES * 60 * 1000).toISOString();
  await sql.run('UPDATE sessions SET finance_unlocked_until = ? WHERE id = ?', [until, sessionId]);
}

export async function lockFinance(sessionId: string): Promise<void> {
  const sql = getSql();
  await sql.run('UPDATE sessions SET finance_unlocked_until = NULL WHERE id = ?', [sessionId]);
}

export async function isFinanceUnlocked(sessionId: string | undefined): Promise<boolean> {
  if (!sessionId) return false;
  const sql = getSql();
  const row = await sql.row<any>("SELECT 1 FROM sessions WHERE id = ? AND finance_unlocked_until IS NOT NULL AND CAST(finance_unlocked_until AS TEXT) > CAST(CURRENT_TIMESTAMP AS TEXT)", [sessionId]);
  return !!row;
}

// ─── Brute-force throttle for unlock attempts (in-memory, per user) ──────────
const UNLOCK_WINDOW_MS = 15 * 60 * 1000;
const unlockAttempts = new Map<string, { count: number; resetAt: number }>();

/** Returns true if another attempt is allowed; records the attempt. */
export function checkUnlockRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = unlockAttempts.get(userId);
  if (!entry || now > entry.resetAt) {
    unlockAttempts.set(userId, { count: 1, resetAt: now + UNLOCK_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= 5;
}

export function clearUnlockRateLimit(userId: string): void {
  unlockAttempts.delete(userId);
}

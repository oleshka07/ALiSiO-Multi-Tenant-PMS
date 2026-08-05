// ============================================================
// ALiSiO PMS — Auth Helpers
// ============================================================

import { getSql } from '../db/async.ts';
import { getUserPermissions, type Permission, type PermissionOverride } from './permissions';
import type { UserRole } from '@/types/database';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const SESSION_DURATION_DAYS = 30;

// ─── Password helpers ─────────────────────────────────────
export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

// ─── Session helpers ──────────────────────────────────────
export interface SessionUser {
  id: string;
  organization_id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  is_active: number;
  permissions: Permission[];
}

export async function createSession(userId: string): Promise<string> {
  const sql = getSql();
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(
    Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  await sql.run('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)', [sessionId, userId, expiresAt]);

  return sessionId;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const sql = getSql();
  await sql.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
}

export async function getSessionUser(sessionId: string | undefined): Promise<SessionUser | null> {
  if (!sessionId) return null;

  const sql = getSql();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: any = await sql.row<any>(`
    SELECT u.id, u.organization_id, u.email, u.full_name, u.phone, u.role, u.is_active
    FROM sessions s
    JOIN app_users u ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP AND u.is_active = 1
  `, [sessionId]);

  if (!row) return null;

  // Load permission overrides
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const overrides: PermissionOverride[] = (await sql.rows<any>('SELECT permission, granted FROM user_permissions WHERE user_id = ?', [row.id])).map((o: any) => ({
    permission: o.permission as Permission,
    granted: o.granted === 1,
  }));

  const permissions = getUserPermissions(row.role, overrides);

  return {
    id: row.id,
    organization_id: row.organization_id,
    email: row.email,
    full_name: row.full_name,
    phone: row.phone,
    role: row.role,
    is_active: row.is_active,
    permissions,
  };
}

// ─── Extract session ID from cookie header ────────────────
export function getSessionIdFromCookies(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(/session_id=([^;]+)/);
  return match ? match[1] : undefined;
}

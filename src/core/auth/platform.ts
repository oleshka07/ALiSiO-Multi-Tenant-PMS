/**
 * The supplier's own way in.
 *
 * Everyone in `app_users` belongs to exactly one hotel — that is where a
 * session gets its tenant and what every policy in the schema compares
 * against. Correct for the people who work in a hotel, useless for the one who
 * sells them the product: onboarding ten customers meant ten accounts, and the
 * only door into a new one was the owner password printed once at
 * provisioning. Hand it to the customer, they change it, and the supplier is
 * locked out of a system they are on the hook for.
 *
 * A platform session is a different cookie, a different table and a different
 * code path. It does not widen what an ordinary user can reach; `app_users`
 * still means one person, one hotel.
 *
 * Two things make this safe enough to exist:
 *
 *  1. It is never ambient. A platform session starts OUTSIDE every customer
 *     (`acting_organization_id IS NULL`) and reaches exactly one at a time,
 *     chosen deliberately. There is no query that spans tenants.
 *  2. It signs its own work. The synthetic user carries the platform email in
 *     `full_name`, so every audit row, every «changed by» and every document
 *     the session touches says who it really was — without a single call site
 *     having to know that impersonation exists. Entering and leaving are
 *     recorded in `platform_audit`, which belongs to the CUSTOMER and shows up
 *     in their own change log.
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getSql } from '../db/async.ts';
import { runWithOrganization } from './tenant-context.ts';
import { ALL_PERMISSIONS } from './permissions';
import { DEFAULT_LANGUAGE, parseLanguage } from '../i18n/languages.ts';
import type { SessionUser } from './auth';

/**
 * Shorter than the 30 days a hotel employee gets. This one credential opens
 * every customer's data, including their guests' passport details; a laptop
 * left open at a conference should not still be inside somebody's hotel a
 * month later.
 */
const PLATFORM_SESSION_HOURS = 24;

/** Its own cookie, so a platform session can never be mistaken for a customer's. */
export const PLATFORM_COOKIE = 'platform_session_id';

export interface PlatformSession {
  sessionId: string;
  userId: string;
  email: string;
  fullName: string | null;
  /** Which hotel this session is standing inside right now, if any. */
  actingOrganizationId: string | null;
}

export function hashPlatformPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export async function verifyPlatformLogin(email: string, password: string): Promise<{ id: string; email: string; full_name: string | null } | null> {
  const sql = getSql();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: any = await sql.row<any>(
    'SELECT id, email, full_name, password_hash, is_active FROM platform_users WHERE lower(email) = lower(?)',
    [email],
  );
  if (!row || !row.password_hash) return null;
  // is_active arrives as 1/0 on SQLite and true/false on Postgres.
  if (!row.is_active) return null;
  if (!bcrypt.compareSync(password, row.password_hash)) return null;
  return { id: row.id, email: row.email, full_name: row.full_name ?? null };
}

export async function createPlatformSession(platformUserId: string): Promise<string> {
  const sql = getSql();
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + PLATFORM_SESSION_HOURS * 60 * 60 * 1000).toISOString();
  await sql.run(
    'INSERT INTO platform_sessions (id, platform_user_id, acting_organization_id, expires_at) VALUES (?, ?, NULL, ?)',
    [id, platformUserId, expiresAt],
  );
  await sql.run('UPDATE platform_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [platformUserId]);
  return id;
}

export async function deletePlatformSession(sessionId: string): Promise<void> {
  const sql = getSql();
  await sql.run('DELETE FROM platform_sessions WHERE id = ?', [sessionId]);
}

export async function getPlatformSession(sessionId: string | undefined): Promise<PlatformSession | null> {
  if (!sessionId) return null;
  const sql = getSql();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: any = await sql.row<any>(`
    SELECT s.id, s.acting_organization_id, u.id AS user_id, u.email, u.full_name
    FROM platform_sessions s
    JOIN platform_users u ON u.id = s.platform_user_id
    WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP AND u.is_active = TRUE
  `, [sessionId]);
  if (!row) return null;
  return {
    sessionId: row.id,
    userId: row.user_id,
    email: row.email,
    fullName: row.full_name ?? null,
    actingOrganizationId: row.acting_organization_id ?? null,
  };
}

/** Step into one hotel. Recorded where the customer can see it. */
export async function enterOrganization(session: PlatformSession, organizationId: string, ip: string | null): Promise<boolean> {
  const sql = getSql();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const org: any = await sql.row<any>('SELECT id FROM organizations WHERE id = ?', [organizationId]);
  if (!org) return false;

  // Going straight from one hotel to another still leaves the first one, and
  // its log has to say so. Without this a customer's record showed somebody
  // entering and never coming out — which reads like they are still in there.
  if (session.actingOrganizationId && session.actingOrganizationId !== organizationId) {
    await writePlatformAudit(session.actingOrganizationId, session, 'leave', ip);
  }
  if (session.actingOrganizationId === organizationId) return true;

  await sql.run('UPDATE platform_sessions SET acting_organization_id = ? WHERE id = ?', [organizationId, session.sessionId]);
  await writePlatformAudit(organizationId, session, 'enter', ip);
  return true;
}

export async function leaveOrganization(session: PlatformSession, ip: string | null): Promise<void> {
  const sql = getSql();
  if (session.actingOrganizationId) {
    await writePlatformAudit(session.actingOrganizationId, session, 'leave', ip);
  }
  await sql.run('UPDATE platform_sessions SET acting_organization_id = NULL WHERE id = ?', [session.sessionId]);
}

/**
 * The row belongs to the customer, so it is written as the customer — the
 * policy on this table is the ordinary tenant one, and an INSERT outside the
 * organization would be filtered away silently.
 */
async function writePlatformAudit(organizationId: string, session: PlatformSession, action: 'enter' | 'leave', ip: string | null): Promise<void> {
  const sql = getSql();
  await runWithOrganization(organizationId, () => sql.run(
    'INSERT INTO platform_audit (organization_id, platform_user_id, platform_email, action, ip) VALUES (?, ?, ?, ?, ?)',
    [organizationId, session.userId, session.email, action, ip],
  ));
}

/**
 * What the rest of the application sees while the supplier is inside a hotel.
 *
 * A real `SessionUser`, so nothing downstream needs to know this is not an
 * employee — except the name, which says exactly that. Anything that stamps a
 * user onto a record (booking audit, finance audit, «changed by») therefore
 * marks support work correctly without a single call site being touched.
 *
 * Full permissions: the job is onboarding and fixing what a customer cannot
 * fix themselves, and a support account that cannot reach the broken screen is
 * not support.
 */
export async function actingUserFor(session: PlatformSession, organizationId: string): Promise<SessionUser> {
  const sql = getSql();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const org: any = await sql.row<any>('SELECT language FROM organizations WHERE id = ?', [organizationId]);
  const orgLanguage = parseLanguage(org?.language, DEFAULT_LANGUAGE);

  return {
    id: `platform:${session.userId}`,
    organization_id: organizationId,
    email: session.email,
    full_name: `Підтримка ALiSiO (${session.email})`,
    phone: null,
    role: 'owner',
    is_active: 1,
    permissions: [...ALL_PERMISSIONS],
    language: orgLanguage,
    own_language: null,
    organization_language: orgLanguage,
  };
}

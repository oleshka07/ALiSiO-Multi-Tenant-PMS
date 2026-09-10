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
import { ALL_PERMISSIONS, getUserPermissions, type Permission, type PermissionOverride } from './permissions';
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

/**
 * Два роди платформного користувача, і різниця між ними — це перелік (П21).
 *
 * `supplier` — ми. Входить у БУДЬ-ЯКИЙ рахунок, бо саме це його робота:
 * завести клієнта, полагодити те, чого клієнт полагодити не може. Усередині
 * діє синтетичним власником, підписаним «Підтримка ALiSiO», щоб кожен рядок
 * аудиту казав, хто це насправді був.
 *
 * `hotelier` — власник готелю з кількома рахунками. Входить ЛИШЕ у рахунки зі
 * свого переліку (`platform_memberships`) і всередині лишається СОБОЮ: своє
 * імʼя в журналі змін рахунку, своя роль, свої права. Не постачальник.
 *
 * Розрізняти їх треба саме тут, а не на екрані: без переліку той самий вхід
 * означав би доступ до всіх готелів на сервері.
 */
export type PlatformKind = 'supplier' | 'hotelier';

export interface PlatformSession {
  sessionId: string;
  userId: string;
  email: string;
  fullName: string | null;
  /** Supplier or hotelier — decides which accounts this session may reach. */
  kind: PlatformKind;
  /** Which hotel this session is standing inside right now, if any. */
  actingOrganizationId: string | null;
}

/** Рахунок, у який ця людина може увійти. */
export interface PlatformAccount {
  id: string;
  name: string;
  slug: string;
  language: string | null;
  default_currency: string | null;
  created_at: string | null;
}

/**
 * Рід читається зі значення, а не «все, що не supplier, — готельєр»: невідоме
 * значення в колонці означає, що ми його не розуміємо, і тоді діє слабший рід
 * (інваріант 13 — перевірка, яка не знайшла рядка, відмовляє, а не дозволяє).
 */
function kindOf(raw: unknown): PlatformKind {
  return raw === 'supplier' ? 'supplier' : 'hotelier';
}

export function hashPlatformPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export async function verifyPlatformLogin(email: string, password: string): Promise<{ id: string; email: string; full_name: string | null; kind: PlatformKind } | null> {
  const sql = getSql();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: any = await sql.row<any>(
    'SELECT id, email, full_name, password_hash, is_active, kind FROM platform_users WHERE lower(email) = lower(?)',
    [email],
  );
  if (!row || !row.password_hash) return null;
  // is_active arrives as 1/0 on SQLite and true/false on Postgres.
  if (!row.is_active) return null;
  if (!bcrypt.compareSync(password, row.password_hash)) return null;
  return { id: row.id, email: row.email, full_name: row.full_name ?? null, kind: kindOf(row.kind) };
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
    SELECT s.id, s.acting_organization_id, u.id AS user_id, u.email, u.full_name, u.kind
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
    kind: kindOf(row.kind),
    actingOrganizationId: row.acting_organization_id ?? null,
  };
}

/**
 * Рахунки, у які ця людина може входити — одні двері для списку і для входу.
 *
 * Постачальник бачить усі: це той самий єдиний запит через орендарів, що й
 * був, і він читає лише назви. Готельєр бачить свій перелік — і саме тому
 * список і перевірка входу мусять питати ОДНЕ І ТЕ САМЕ: список, ширший за
 * перелік, це вже витік, навіть коли увійти в зайвий рядок не можна.
 */
export async function accountsFor(session: PlatformSession): Promise<PlatformAccount[]> {
  const sql = getSql();
  if (session.kind === 'supplier') {
    return await sql.rows<PlatformAccount>(`
      SELECT o.id, o.name, o.slug, o.language, o.default_currency, o.created_at
      FROM organizations o ORDER BY o.name
    `);
  }
  return await sql.rows<PlatformAccount>(`
    SELECT o.id, o.name, o.slug, o.language, o.default_currency, o.created_at
    FROM platform_memberships m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.platform_user_id = ?
    ORDER BY o.name
  `, [session.userId]);
}

/**
 * Ким ця людина є в цьому рахунку — або нічим, і тоді входу немає.
 *
 * Повертає рядок `app_users`, названий членством. `null` означає «членства
 * немає», а не «людина без ролі»: колонка `app_user_id` у переліку
 * NOT NULL саме тому, що членство без відповіді на це питання змусило б код
 * щось підставити.
 */
async function membershipUserId(session: PlatformSession, organizationId: string): Promise<string | null> {
  if (session.kind === 'supplier') return null;
  const sql = getSql();
  const row = await sql.row<{ app_user_id: string }>(
    'SELECT app_user_id FROM platform_memberships WHERE platform_user_id = ? AND organization_id = ?',
    [session.userId, organizationId],
  );
  return row?.app_user_id ?? null;
}

/**
 * Чи може ця сесія увійти в цей рахунок.
 *
 * Постачальник — у будь-який наявний; готельєр — лише в той, що в переліку.
 * Порядок саме такий: спершу рід, потім перелік. Питати перелік у
 * постачальника означало б заводити йому членство на кожного нового клієнта,
 * тобто ламати те, заради чого платформний вхід і зроблено.
 */
async function mayEnter(session: PlatformSession, organizationId: string): Promise<boolean> {
  const sql = getSql();
  const org = await sql.row<{ id: string }>('SELECT id FROM organizations WHERE id = ?', [organizationId]);
  if (!org) return false;
  if (session.kind === 'supplier') return true;
  return (await membershipUserId(session, organizationId)) !== null;
}

/** Step into one hotel. Recorded where the customer can see it. */
export async function enterOrganization(session: PlatformSession, organizationId: string, ip: string | null): Promise<boolean> {
  const sql = getSql();
  // Перелік питається ПЕРШИМ, до будь-якого запису (П21). Відмова, яка встигла
  // лишити слід у журналі чужого рахунку або пересунути сесію, — це не
  // відмова: власник того рахунку побачив би в себе вхід, якого не було.
  if (!(await mayEnter(session, organizationId))) return false;

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
export async function actingUserFor(session: PlatformSession, organizationId: string): Promise<SessionUser | null> {
  const sql = getSql();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const org: any = await sql.row<any>('SELECT language FROM organizations WHERE id = ?', [organizationId]);
  const orgLanguage = parseLanguage(org?.language, DEFAULT_LANGUAGE);

  // Готельєр усередині свого рахунку — ЦЕ ВІН, а не підтримка (П21).
  //
  // Тут два наслідки, і обидва видно лише в рахунку. Перший: журнал змін. Усе,
  // що штампує користувача на запис, бере `full_name`, тож із синтетичним
  // рядком власник готелю бачив би в себе «Підтримка ALiSiO» під кожною своєю
  // правкою — рівно навпаки до того, для чого цей підпис заводили. Другий:
  // права. `ALL_PERMISSIONS` зробили б менеджера власником, і роль, яку рахунок
  // сам собі призначив, перестала б щось означати.
  //
  // Членства немає — немає й особи: повертається `null`, і сесія лишається без
  // орендаря, тобто відмовляє як чужому (інваріант 13). Мовчазно підставити
  // когось тут — це і є та вада, від якої колонка `app_user_id` NOT NULL.
  if (session.kind === 'hotelier') {
    const appUserId = await membershipUserId(session, organizationId);
    if (!appUserId) return null;
    return await memberUser(appUserId, organizationId, orgLanguage);
  }

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

/**
 * Справжня особа готельєра в цьому рахунку.
 *
 * Те саме, що робить `getSessionUser` для звичайного входу, і навмисно тим
 * самим способом: роль плюс індивідуальні поправки прав. Поправки читаються В
 * КОНТЕКСТІ рахунку — `user_permissions` scoped через `app_users`, і без
 * контексту політика Postgres віддала б нуль рядків, тобто ВІДІБРАНЕ право
 * повернулося б (той самий клас, що описано в `auth.ts`: відмова, яка
 * відкривається мовчки).
 */
async function memberUser(
  appUserId: string,
  organizationId: string,
  orgLanguage: string,
): Promise<SessionUser | null> {
  const sql = getSql();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: any = await runWithOrganization(organizationId, () => sql.row<any>(
    `SELECT id, organization_id, email, full_name, phone, role, is_active, language AS own_language
       FROM app_users WHERE id = ? AND organization_id = ? AND is_active = TRUE`,
    [appUserId, organizationId],
  ));
  if (!row) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const overrideRows = await runWithOrganization(organizationId, () => sql.rows<any>(
    'SELECT permission, granted FROM user_permissions WHERE user_id = ?',
    [appUserId],
  ));
  const overrides: PermissionOverride[] = overrideRows.map((o: any) => ({
    permission: o.permission as Permission,
    granted: o.granted === 1 || o.granted === true,
  }));

  return {
    id: row.id,
    organization_id: row.organization_id,
    email: row.email,
    full_name: row.full_name,
    phone: row.phone ?? null,
    role: row.role,
    is_active: 1,
    permissions: getUserPermissions(row.role, overrides),
    language: parseLanguage(row.own_language, orgLanguage as any),
    own_language: row.own_language ?? null,
    organization_language: orgLanguage as any,
  };
}

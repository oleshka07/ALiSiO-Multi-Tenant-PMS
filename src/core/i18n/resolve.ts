/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Where a language comes from, in order of who gets the last word.
 *
 *   the person   app_users.language      set it once, it follows you
 *   the hotel    organizations.language  chosen when the customer is created
 *   the browser  Accept-Language         only for guests, who have no account
 *   the product  DEFAULT_LANGUAGE
 *
 * On the async seam like the rest of core: these run against Postgres too, and
 * a synchronous better-sqlite3 handle does not survive that crossing.
 *
 * Each takes an optional `Sql` so the self-check can point them at an
 * in-memory database — the same shape widget/certificate.repo and
 * finance/invoice-numbering use for the same reason.
 */

import { type Sql, getSql } from '../db/async.ts';
import { DEFAULT_LANGUAGE, type Language, fromAcceptLanguage, parseLanguage } from './languages.ts';

/** The hotel's base language — the interface default and the content source. */
export async function organizationLanguage(
  organizationId: string,
  sql: Sql = getSql(),
): Promise<Language> {
  if (!organizationId) return DEFAULT_LANGUAGE;
  const row = await sql.row<any>('SELECT language FROM organizations WHERE id = ?', [
    organizationId,
  ]);
  return parseLanguage(row?.language, DEFAULT_LANGUAGE);
}

/** One person's effective language: their own choice, else the hotel's. */
export async function userLanguage(userId: string, sql: Sql = getSql()): Promise<Language> {
  const row = await sql.row<any>(
    `SELECT u.language AS own, o.language AS org
       FROM app_users u
       LEFT JOIN organizations o ON o.id = u.organization_id
      WHERE u.id = ?`,
    [userId],
  );
  if (!row) return DEFAULT_LANGUAGE;
  return parseLanguage(row.own, parseLanguage(row.org, DEFAULT_LANGUAGE));
}

/**
 * NULL clears a personal choice and puts the person back on the hotel's
 * language — which is different from pinning them to the same code today,
 * because the hotel may change its mind later.
 */
export async function setUserLanguage(
  userId: string,
  language: Language | null,
  sql: Sql = getSql(),
): Promise<void> {
  await sql.run('UPDATE app_users SET language = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
    language,
    userId,
  ]);
}

export async function setOrganizationLanguage(
  organizationId: string,
  language: Language,
  sql: Sql = getSql(),
): Promise<void> {
  await sql.run(
    'UPDATE organizations SET language = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [language, organizationId],
  );
}

/**
 * A guest has no account, so the hotel's language leads and the browser only
 * breaks the tie. A guest who picks a language in the portal overrides both,
 * client-side — that choice is not ours to store.
 */
export async function guestLanguage(
  organizationId: string,
  acceptLanguage?: string | null,
): Promise<Language> {
  return fromAcceptLanguage(acceptLanguage, await organizationLanguage(organizationId));
}

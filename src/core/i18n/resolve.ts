/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Where a language comes from, in order of who gets the last word.
 *
 * There are three audiences and they are not the same question. Keeping them
 * apart is the whole point of this file: an operator switching to German is
 * changing what SHE reads, and must not change a guest's email or a filed
 * invoice.
 *
 *   the operator   userLanguage()          app_users.language → the hotel's
 *   the guest      reservationLanguage()   what the guest told us, in order
 *   the document   documentLanguage()      the jurisdiction, never a person
 *
 * Within the operator's chain:
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
 * A guest with no booking yet — the widget, the public portal.
 *
 * The hotel's language leads and the browser only breaks the tie. A guest who
 * picks a language in the portal overrides both, client-side; that choice is
 * not ours to store.
 */
export async function guestLanguage(
  organizationId: string,
  acceptLanguage?: string | null,
): Promise<Language> {
  return fromAcceptLanguage(acceptLanguage, await organizationLanguage(organizationId));
}

/**
 * Which country speaks which language, for the purpose of issuing a document.
 *
 * Deliberately crude: this is not "what language do people there speak", it is
 * "what language does a business letter from there arrive in". Where a country
 * genuinely has several, the entry is the one used in commerce.
 */
const JURISDICTION: Record<string, Language> = {
  CZ: 'cs',
  DE: 'de',
  AT: 'de',
  CH: 'de',
  UA: 'uk',
  PL: 'pl',
  NL: 'nl',
  BE: 'nl',
  FR: 'fr',
  GB: 'en',
  IE: 'en',
  US: 'en',
};

/**
 * The language a booking's guest reads.
 *
 * In order of how much the guest actually told us:
 *
 *   guests.language        they said so outright
 *   reservations.booking_lang   the language they booked in
 *   guests.country         where they are, as a last guess
 *   the hotel              which is at least a real decision by somebody
 *
 * Before this, the reminder and abandoned-cart emails guessed from the phone's
 * dialling code — so a German living in Prague with a Czech number was written
 * to in Czech, while `booking_lang`, recorded at the moment they chose, sat
 * unused two columns away. `guests.language` existed and was read by nothing at
 * all.
 *
 * Never the operator's language: which receptionist happens to be on shift is
 * not a fact about the guest.
 */
export async function reservationLanguage(
  reservationId: string,
  sql: Sql = getSql(),
): Promise<Language> {
  const row = await sql.row<any>(
    `SELECT g.language AS chosen, r.booking_lang AS booked, g.country AS country,
            o.language AS hotel
       FROM reservations r
       LEFT JOIN guests g ON g.id = r.guest_id
       LEFT JOIN organizations o ON o.id = r.organization_id
      WHERE r.id = ?`,
    [reservationId],
  );
  if (!row) return DEFAULT_LANGUAGE;

  const hotel = parseLanguage(row.hotel, DEFAULT_LANGUAGE);
  const fromCountry = row.country ? JURISDICTION[String(row.country).toUpperCase()] : undefined;
  return parseLanguage(row.chosen, parseLanguage(row.booked, fromCountry ?? hotel));
}

/**
 * The language a document is issued in.
 *
 * This is the jurisdiction's, not the hotel's and emphatically not the
 * operator's. ALiSiO is registered in Czechia and its staff are Ukrainian: its
 * invoices are Czech, and they stay Czech when a German manager joins and
 * switches the interface. Reading `organizations.language` here would have
 * turned every invoice Ukrainian — which is why "the hotel's language" is the
 * wrong answer even though it is not the operator's.
 *
 * The hotel's own language is the fallback only when the property has no
 * country, which is a data gap rather than a jurisdiction.
 */
export async function documentLanguage(
  propertyId: string,
  sql: Sql = getSql(),
): Promise<Language> {
  const row = await sql.row<any>(
    `SELECT p.country AS country, o.language AS hotel
       FROM properties p
       LEFT JOIN organizations o ON o.id = p.organization_id
      WHERE p.id = ?`,
    [propertyId],
  );
  if (!row) return DEFAULT_LANGUAGE;
  const byCountry = row.country ? JURISDICTION[String(row.country).toUpperCase()] : undefined;
  return byCountry ?? parseLanguage(row.hotel, DEFAULT_LANGUAGE);
}

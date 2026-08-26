/* eslint-disable @typescript-eslint/no-explicit-any */
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { FEATURES, setFeature, type FeatureKey } from './features.ts';
import { getSql } from './db/async.ts';
import { runWithOrganization } from './auth/tenant-context.ts';
import { DEFAULT_LANGUAGE, LANGUAGE_CODES, isLanguage } from './i18n/languages.ts';
import { defaultBookingSources } from './booking-sources.ts';

/**
 * Creating a customer.
 *
 * Everything else in this codebase was made multi-tenant — scoping, the
 * feature registry, row-level policies — while there remained exactly ONE way
 * to get a second organization into the database: write the INSERTs by hand.
 * So the isolation was only ever exercised against probe rows a test script
 * made up. This is the missing half: one function that provisions a real
 * tenant the same way every time, and can be called from a script today and a
 * signup form later.
 *
 * Imports here are relative WITH the .ts extension so the module loads both
 * under the bundler and under plain node — scripts/provision-org.mjs runs it
 * directly, and '@core/…' means nothing outside webpack.
 *
 * What a working organization needs, in one transaction:
 *   organization → owner (real password hash) → property → a category, so the
 *   calendar has something to group by → feature rows, all OFF.
 *
 * Features start off ON PURPOSE. A new customer has no Teya account, no
 * Hostex token and no widget site; showing them menu items that answer 403 is
 * worse than not showing them at all. The operator turns each on when it is
 * actually configured.
 */

export interface NewOrganization {
  name: string;
  slug: string;
  ownerEmail: string;
  ownerPassword: string;
  ownerName?: string;
  propertyName?: string;
  city?: string;
  country?: string;
  currency?: string;
  timezone?: string;
  /**
   * The hotel's base language. Its staff get the interface in it, and it is
   * the language its people type content in — so it is also the source the
   * guest-facing translations are made from. Defaults to Ukrainian, which is
   * what the product itself is still written in.
   */
  language?: string;
  /** Features to switch on immediately. Everything else stays off. */
  enable?: FeatureKey[];
}

export interface ProvisionedOrganization {
  organizationId: string;
  propertyId: string;
  ownerId: string;
  language: string;
}

/**
 * The one seeded category, in the hotel's own language. It exists so the
 * calendar has a group to draw and the hotel renames it on day one — but
 * handing a German hotel a category called "Номери" is a poor first screen.
 */
const DEFAULT_CATEGORY_NAME: Record<string, string> = {
  uk: 'Номери',
  en: 'Rooms',
  de: 'Zimmer',
  cs: 'Pokoje',
  pl: 'Pokoje',
  nl: 'Kamers',
  fr: 'Chambres',
};

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$/;

export async function provisionOrganization(input: NewOrganization): Promise<ProvisionedOrganization> {
  const sql = getSql();

  const name = input.name?.trim();
  const slug = input.slug?.trim().toLowerCase();
  const email = input.ownerEmail?.trim().toLowerCase();

  if (!name) throw new Error('name is required');
  if (!slug || !SLUG_RE.test(slug)) {
    throw new Error('slug must be 2–40 chars, lowercase letters, digits and dashes, not starting or ending with a dash');
  }
  if (!email || !email.includes('@')) throw new Error('a valid ownerEmail is required');
  if (!input.ownerPassword || input.ownerPassword.length < 12) {
    throw new Error('ownerPassword must be at least 12 characters');
  }

  // Rejected rather than quietly defaulted: a typo here means the hotel's
  // staff get the wrong interface and its content is translated from the
  // wrong source, and neither is obvious from the inside.
  const language = input.language?.trim().toLowerCase() || DEFAULT_LANGUAGE;
  if (!isLanguage(language)) {
    throw new Error(`language must be one of: ${LANGUAGE_CODES.join(', ')}`);
  }

  // Checked before the transaction so the caller gets the real reason rather
  // than a UNIQUE constraint message.
  if (await sql.row<any>('SELECT 1 FROM organizations WHERE slug = ?', [slug])) {
    throw new Error(`slug "${slug}" is taken`);
  }
  if (await sql.row<any>('SELECT 1 FROM app_users WHERE lower(email) = ?', [email])) {
    throw new Error(`a user with email "${email}" already exists`);
  }

  const organizationId = `org_${crypto.randomBytes(8).toString('hex')}`;
  const propertyId = `prop_${crypto.randomBytes(8).toString('hex')}`;
  const ownerId = `user_${crypto.randomBytes(8).toString('hex')}`;
  const categoryId = `cat_${crypto.randomBytes(8).toString('hex')}`;

  // As the organization being created. Postgres applies WITH CHECK to every
  // insert — a row whose organization_id does not match the connection's tenant
  // is rejected — and this is the one caller that has no tenant to inherit,
  // because it is making one. The id exists already, so the transaction can run
  // as it: postgres.ts reads this context once, at BEGIN.
  await runWithOrganization(organizationId, async () => await sql.tx(async (t) => {
    await t.run(`
      INSERT INTO organizations (id, name, slug, timezone, default_currency, language)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [organizationId, name, slug, input.timezone || 'Europe/Prague', input.currency || 'CZK', language]);

    // Currency lives on the organization; a property carries location and
    // times. (getOrgIdentity and the ARI push both read it from there.)
    await t.run(`
      INSERT INTO properties (id, organization_id, name, slug, city, country)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [propertyId, organizationId,
      input.propertyName || name,
      `${slug}-1`,
      input.city || null,
      input.country || 'CZ']);

    // One category so the calendar has a group to draw. Its name is generic on
    // purpose — the hotel renames it, and the type is now free text.
    await t.run(`
      INSERT INTO categories (id, property_id, name, type, sort_order)
      VALUES (?, ?, ?, 'rooms', 1)
    `, [categoryId, propertyId, DEFAULT_CATEGORY_NAME[language] ?? DEFAULT_CATEGORY_NAME.en]);

    // Канали, з яких приходить бронь. Без них КОЖНА бронь малюється сірим
    // бейджем «direct» — однаковим для прямого гостя, дзвінка й пошти, — а
    // звіт «звідки приходять гості» показує одну колонку.
    //
    // Наповнювала цю таблицю рівно одна SQLite-міграція, і рівно для
    // `properties LIMIT 1`: список діставався demo-seed, а кожен реальний
    // готель стартував порожнім. На Postgres та міграція не виконується
    // взагалі. Місце цього — тут, де готель заводиться.
    //
    // OTA в списку немає навмисно: див. booking-sources.ts.
    for (const s of defaultBookingSources(language)) {
      await t.run(`
        INSERT INTO booking_sources (id, property_id, name, code, icon_letter, color, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [`bs_${crypto.randomBytes(8).toString('hex')}`, propertyId,
        s.name, s.code, s.iconLetter, s.color, s.sortOrder]);
    }

    // The owner's language stays NULL: they follow the hotel, so changing the
    // hotel's base language later moves them with it.
    await t.run(`
      INSERT INTO app_users (id, organization_id, email, full_name, role, password_hash)
      VALUES (?, ?, ?, ?, 'owner', ?)
    `, [ownerId, organizationId, email, input.ownerName || name, bcrypt.hashSync(input.ownerPassword, 10)]);

    // Every feature gets a row, so the state is explicit rather than absent.
    // Through `t`, not the pool: these rows reference an organization this
    // transaction has not committed yet, so on Postgres a second connection
    // would fail the foreign key. On SQLite there is only ever one connection,
    // which is why writing them outside the transaction worked by accident.
    const wanted = new Set(input.enable || []);
    for (const key of Object.keys(FEATURES) as FeatureKey[]) {
      await setFeature(organizationId, key, wanted.has(key), t);
    }
  }));

  return { organizationId, propertyId, ownerId, language };
}

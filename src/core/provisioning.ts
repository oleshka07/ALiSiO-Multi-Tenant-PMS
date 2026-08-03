/* eslint-disable @typescript-eslint/no-explicit-any */
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getDb } from './db/index.ts';
import { FEATURES, setFeature, type FeatureKey } from './features.ts';

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
  /** Features to switch on immediately. Everything else stays off. */
  enable?: FeatureKey[];
}

export interface ProvisionedOrganization {
  organizationId: string;
  propertyId: string;
  ownerId: string;
}

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$/;

export function provisionOrganization(input: NewOrganization): ProvisionedOrganization {
  const db = getDb();

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

  // Checked before the transaction so the caller gets the real reason rather
  // than a UNIQUE constraint message.
  if (db.prepare('SELECT 1 FROM organizations WHERE slug = ?').get(slug)) {
    throw new Error(`slug "${slug}" is taken`);
  }
  if (db.prepare('SELECT 1 FROM app_users WHERE lower(email) = ?').get(email)) {
    throw new Error(`a user with email "${email}" already exists`);
  }

  const organizationId = `org_${crypto.randomBytes(8).toString('hex')}`;
  const propertyId = `prop_${crypto.randomBytes(8).toString('hex')}`;
  const ownerId = `user_${crypto.randomBytes(8).toString('hex')}`;
  const categoryId = `cat_${crypto.randomBytes(8).toString('hex')}`;

  db.transaction(() => {
    db.prepare(`
      INSERT INTO organizations (id, name, slug, timezone, default_currency)
      VALUES (?, ?, ?, ?, ?)
    `).run(organizationId, name, slug, input.timezone || 'Europe/Prague', input.currency || 'CZK');

    // Currency lives on the organization; a property carries location and
    // times. (getOrgIdentity and the ARI push both read it from there.)
    db.prepare(`
      INSERT INTO properties (id, organization_id, name, slug, city, country)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      propertyId, organizationId,
      input.propertyName || name,
      `${slug}-1`,
      input.city || null,
      input.country || 'CZ',
    );

    // One category so the calendar has a group to draw. Its name is generic on
    // purpose — the hotel renames it, and the type is now free text.
    db.prepare(`
      INSERT INTO categories (id, property_id, name, type, sort_order)
      VALUES (?, ?, 'Номери', 'rooms', 1)
    `).run(categoryId, propertyId);

    db.prepare(`
      INSERT INTO app_users (id, organization_id, email, full_name, role, password_hash)
      VALUES (?, ?, ?, ?, 'owner', ?)
    `).run(ownerId, organizationId, email, input.ownerName || name, bcrypt.hashSync(input.ownerPassword, 10));

    // Every feature gets a row, so the state is explicit rather than absent.
    const wanted = new Set(input.enable || []);
    for (const key of Object.keys(FEATURES) as FeatureKey[]) {
      setFeature(db, organizationId, key, wanted.has(key));
    }
  })();

  return { organizationId, propertyId, ownerId };
}

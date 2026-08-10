/**
 * The organization a piece of work belongs to, carried across the call stack.
 *
 * 66 files answer "which organization is this?" with
 * `SELECT id FROM organizations LIMIT 1` — whichever row happens to be first.
 * On one hotel that is right by accident. On a shared server it means a
 * repository three calls down from a handler files a tag, a project, a bank
 * statement or a booking source under someone else's company, and nothing in
 * the request said so.
 *
 * Threading the id through every one of those call chains would touch hundreds
 * of signatures. The guards already know the organization, so they establish it
 * here once and everything underneath reads it.
 *
 * requireOrganizationId falls back to the sole organization when the context is
 * not set. That keeps a single-tenant server working exactly as before, and on
 * a server with more than one it raises instead of guessing — an unscoped call
 * becomes a loud failure rather than a silent write into another tenant's data.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { getSql } from '../db/async.ts';

const store = new AsyncLocalStorage<string>();

/** Run fn with this organization as the ambient tenant. */
export function runWithOrganization<T>(organizationId: string, fn: () => T): T {
  return store.run(organizationId, fn);
}

/** The ambient organization, or null outside any request that established one. */
export function currentOrganizationId(): string | null {
  return store.getStore() ?? null;
}

/**
 * A secret from a link, for the one lookup that happens before any tenant.
 *
 * Someone holding a link holds nothing else — no session, no site key, no
 * organization. The tables those links point at cannot be opened to
 * tenant-less reads (that would be every booking, every report on the server),
 * so the token travels the same way the organization does: onto the
 * connection, where the policy compares it against the row's own token column
 * and matches exactly the row it names.
 *
 * One setting, not one per feature. The guest portal came first and the
 * partner report needs the same thing; `app.guest_token` and
 * `app.report_token` side by side would be two names for one idea, and the
 * second reader of the code would have to check both. What varies between
 * them is the column, and that lives in the policy — see PUBLIC_TOKEN_READ in
 * scripts/pg-schema.mjs for the full list of what this opens.
 *
 * Deliberately separate from the organization rather than folded into it: this
 * one grants a single row on read, and nothing else, ever. Once that row is
 * read the route knows its organization and continues under
 * runWithOrganization like everything else — so the window where the token
 * matters is one statement wide.
 */
const publicToken = new AsyncLocalStorage<string>();

/** Run fn with this link token available to the row-level policy. */
export function runWithPublicToken<T>(token: string, fn: () => T): T {
  return publicToken.run(token, fn);
}

/** The ambient link token, or null outside a token-addressed request. */
export function currentPublicToken(): string | null {
  return publicToken.getStore() ?? null;
}

/**
 * The organization to write to or filter by. Throws rather than guess.
 * `db` is the better-sqlite3 handle; passed in to avoid importing the database
 * module from the auth layer.
 */
export async function requireOrganizationId(): Promise<string> {
  const sql = getSql();
  const ambient = store.getStore();
  if (ambient) return ambient;

  const rows = await sql.rows<any>('SELECT id FROM organizations LIMIT 2') as { id: string }[];
  if (rows.length === 1) return rows[0].id;
  if (rows.length === 0) throw new Error('No organization exists');
  throw new Error(
    'No organization in context and more than one exists — this code path must be reached through a guard, or set the organization explicitly with runWithOrganization()',
  );
}

/**
 * The property to act on. The same "first row in the table" shortcut existed
 * for properties, which is worse than for organizations: a hotel group with a
 * second property gets its bookings, iCal channels and booking sites attached
 * to whichever one was created first.
 *
 * An explicit id from the caller wins, and is verified to belong to the
 * organization. With none, the organization's only property is used — most
 * customers have exactly one — and where there are several the caller has to
 * say which.
 */
export async function requirePropertyId(explicitId?: string | null): Promise<string> {
  const sql = getSql();
  const organizationId = await requireOrganizationId();

  if (explicitId) {
    const owned = await sql.row<any>('SELECT 1 FROM properties WHERE id = ? AND organization_id = ?', [explicitId, organizationId]);
    if (!owned) throw new Error('Property not found');
    return explicitId;
  }

  const rows = await sql.rows<any>('SELECT id FROM properties WHERE organization_id = ? LIMIT 2', [organizationId]) as { id: string }[];
  if (rows.length === 1) return rows[0].id;
  if (rows.length === 0) throw new Error('This organization has no property yet');
  throw new Error('This organization has more than one property — property_id is required');
}

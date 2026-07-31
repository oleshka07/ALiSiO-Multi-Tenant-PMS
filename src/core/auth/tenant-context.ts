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
 * The organization to write to or filter by. Throws rather than guess.
 * `db` is the better-sqlite3 handle; passed in to avoid importing the database
 * module from the auth layer.
 */
export function requireOrganizationId(db: any): string {
  const ambient = store.getStore();
  if (ambient) return ambient;

  const rows = db.prepare('SELECT id FROM organizations LIMIT 2').all() as { id: string }[];
  if (rows.length === 1) return rows[0].id;
  if (rows.length === 0) throw new Error('No organization exists');
  throw new Error(
    'No organization in context and more than one exists — this code path must be reached through a guard, or set the organization explicitly with runWithOrganization()',
  );
}

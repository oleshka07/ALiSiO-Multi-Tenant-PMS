/**
 * Identity resolution happens before the tenant is known. What that costs.
 *
 *   node src/core/db/rls-identity.check.ts
 *
 * Two tables are readable with no tenant set, deliberately, because the lookup
 * is HOW the organization is discovered (see READ_BEFORE_TENANT in
 * scripts/pg-schema.mjs):
 *
 *   app_users      login by email; every request joins it through a session id
 *   booking_sites  the widget arrives with a public site key and nothing else
 *
 * The trap is what happens to everything the identity query touches NEXT.
 * `user_permissions` is scoped *through* `app_users`, strictly, with no escape.
 * Read it while the tenant is still empty and the subquery matches nothing — so
 * the query returns no rows and looks like "this person has no overrides".
 *
 * That is not a cosmetic difference. `getUserPermissions` uses an override to
 * REVOKE as well as to grant, so an invisible override restores a permission
 * somebody deliberately took away. It failed open, on the authorisation path,
 * and only on Postgres — SQLite has no RLS, so nothing showed up in review or
 * in any SQLite test.
 *
 * PGlite is real Postgres, and the policies below are copied verbatim from
 * db/postgres/schema.sql. RLS does not apply to a superuser, so everything runs
 * as a plain role — otherwise this file would pass while proving nothing.
 */
import assert from 'node:assert';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();

await db.exec(`
  CREATE TABLE app_users (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, role TEXT);
  CREATE TABLE user_permissions (
    user_id TEXT NOT NULL, permission TEXT NOT NULL, granted BIGINT NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, permission)
  );

  INSERT INTO app_users VALUES ('anna', 'org_a', 'manager'), ('bob', 'org_b', 'manager');
  -- Anna's ROLE grants manage_users; this override takes it away.
  INSERT INTO user_permissions VALUES ('anna', 'manage_users', 0);

  ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
  CREATE POLICY app_users_tenant ON app_users
    USING ("organization_id" = current_setting('app.organization_id') OR current_setting('app.organization_id') = '')
    WITH CHECK ("organization_id" = current_setting('app.organization_id'));

  ALTER TABLE user_permissions ENABLE ROW LEVEL SECURITY;
  CREATE POLICY user_permissions_tenant ON user_permissions
    USING ("user_id" IN (SELECT "id" FROM "app_users" WHERE "organization_id" = current_setting('app.organization_id')))
    WITH CHECK ("user_id" IN (SELECT "id" FROM "app_users" WHERE "organization_id" = current_setting('app.organization_id')));

  CREATE ROLE app_role NOLOGIN;
  GRANT SELECT, INSERT, UPDATE, DELETE ON app_users, user_permissions TO app_role;
`);

/** One statement as the application role, with a given tenant setting. */
async function asApp<T = Record<string, unknown>>(
  organization: string,
  sql: string,
): Promise<T[]> {
  await db.exec('SET ROLE app_role');
  await db.query('SELECT set_config($1, $2, false)', ['app.organization_id', organization]);
  try {
    return (await db.query<T>(sql)).rows;
  } finally {
    await db.exec('RESET ROLE');
  }
}

const OVERRIDES = "SELECT permission, granted FROM user_permissions WHERE user_id = 'anna'";

/** What getUserPermissions does with what it was handed. */
const effective = (rows: { permission: string; granted: number }[]) => {
  const defaults = new Set(['view_bookings', 'manage_users']);
  for (const o of rows) (o.granted === 1 ? defaults.add : defaults.delete).call(defaults, o.permission);
  return defaults;
};

// ─── the identity read is open, and only the read ────────────────────────────
assert.strictEqual(
  (await asApp('', 'SELECT id FROM app_users')).length,
  2,
  'login has to find a person before it can know their organization',
);
await assert.rejects(
  () => asApp('', "INSERT INTO app_users VALUES ('mallory', 'org_a', 'owner')"),
  /row-level security/,
  'the write side never opens, whatever the read side does',
);
console.log('  ok  identity is readable before the tenant, and never writable');

// ─── the trap: a scoped table read in that same window ───────────────────────
const blind = (await asApp('', OVERRIDES)) as { permission: string; granted: number }[];
assert.strictEqual(blind.length, 0, 'user_permissions is scoped through app_users, strictly');
assert.ok(
  effective(blind).has('manage_users'),
  'this is the failure: no overrides visible, so the revoked permission comes back',
);
console.log('  ok  reading a scoped table with no tenant silently returns nothing');

// ─── which is why getSessionUser sets the tenant first ───────────────────────
const scoped = (await asApp('org_a', OVERRIDES)) as { permission: string; granted: number }[];
assert.strictEqual(scoped.length, 1, 'as the organization, the override is there');
assert.ok(
  !effective(scoped).has('manage_users'),
  'and the permission stays revoked, which is the whole point of the override',
);
console.log('  ok  as the organization, a revoked permission stays revoked');

// And the tenant does not leak sideways: org_b must not see Anna's overrides.
assert.strictEqual(
  (await asApp('org_b', OVERRIDES)).length,
  0,
  'another hotel sees nothing of this one',
);
console.log('  ok  and one hotel cannot read the other\'s overrides');

// ─── the guest portal: one row, to whoever holds its token ───────────────────
// A guest has no session and no site key — only a link. `reservations` cannot
// be opened to tenant-less reads, so the token itself is what the policy
// matches. What matters is that it opens exactly one row and nothing else.
await db.exec(`
  CREATE TABLE reservations (
    id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, guest_page_token TEXT
  );
  INSERT INTO reservations VALUES
    ('r_anna', 'org_a', 'tok_anna'),
    ('r_bob',  'org_b', 'tok_bob'),
    ('r_old',  'org_a', '');          -- a row whose token is empty

  ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
  CREATE POLICY reservations_tenant ON reservations
    USING ("organization_id" = current_setting('app.organization_id')
           OR "guest_page_token" = NULLIF(current_setting('app.guest_token', true), ''))
    WITH CHECK ("organization_id" = current_setting('app.organization_id'));
  GRANT SELECT, INSERT, UPDATE, DELETE ON reservations TO app_role;
`);

/** As the application role, with a tenant AND a guest token. */
async function asGuest<T = Record<string, unknown>>(token: string, sql: string): Promise<T[]> {
  await db.exec('SET ROLE app_role');
  await db.query('SELECT set_config($1, $2, false)', ['app.organization_id', '']);
  await db.query('SELECT set_config($1, $2, false)', ['app.guest_token', token]);
  try {
    return (await db.query<T>(sql)).rows;
  } finally {
    await db.exec('RESET ROLE');
    await db.query('SELECT set_config($1, $2, false)', ['app.guest_token', '']);
  }
}

const ALL = 'SELECT id FROM reservations';
assert.deepStrictEqual(
  (await asGuest('tok_anna', ALL)).map((r: any) => r.id), ['r_anna'],
  'the token opens the row it names, and only that row',
);
assert.strictEqual((await asGuest('tok_wrong', ALL)).length, 0, 'a token that names nothing sees nothing');
assert.strictEqual((await asGuest('', ALL)).length, 0, 'no token, no rows — not every row');
console.log('  ok  a guest token opens exactly the reservation it names');

// The reason for NULLIF: a reservation whose own token is '' must not become
// readable to a caller who simply set nothing.
assert.ok(
  !(await asGuest('', ALL)).some((r: any) => r.id === 'r_old'),
  "an empty token must not match a row whose own token is empty",
);
console.log('  ok  an empty token matches nothing, including the empty-token row');

// And the token grants no write, ever.
await assert.rejects(
  () => asGuest('tok_anna', "UPDATE reservations SET organization_id = 'org_b' WHERE id = 'r_anna'"),
  /row-level security/,
  'a guest token must never permit a write',
);
console.log('  ok  and it never permits a write');

await db.close();
console.log('rls-identity: the tenant is set before anything scoped is read');

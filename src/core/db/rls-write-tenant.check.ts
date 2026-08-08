/**
 * An inserted row belongs to the tenant the statement is running as.
 *
 *   node src/core/db/rls-write-tenant.check.ts
 *
 * Reading never had to name the organization — the policy adds it. Writing did,
 * in every column list, and fourteen INSERT statements in this codebase did not.
 * On Postgres every one of them was refused:
 *
 *   INSERT INTO widget_handshakes (token, site_id, expires_at) VALUES (…)
 *
 * organization_id is absent, so it is NULL, and the policy asks
 * `NULL = 'org_…'` — which is NULL, not true. Establishing the tenant context
 * correctly does not help: the context is what the policy compares the column
 * against, not what fills it. The error says "row-level security" and never
 * names the column, and every one of those statements read as correct code.
 *
 * The booking handshake was among them, so no guest could begin a reservation.
 *
 * Hence the default, in db/postgres/schema.sql and migration 0005. The three
 * claims below are the whole of it, and the third is the one that makes the
 * default safe rather than convenient: with no tenant the setting is '', and a
 * bare default would write a row into an empty organization — belonging to
 * nothing, visible to nobody. NULLIF turns that back into an error.
 *
 * PGlite is real Postgres, and everything runs as a plain role: RLS does not
 * apply to a superuser, and this file would pass while proving nothing.
 */
import assert from 'node:assert';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();

await db.exec(`
  CREATE TABLE organizations (id TEXT PRIMARY KEY);
  INSERT INTO organizations VALUES ('org_a'), ('org_b');

  CREATE TABLE handshakes (
    token TEXT PRIMARY KEY,
    organization_id TEXT REFERENCES organizations(id),
    site_id TEXT
  );

  -- Exactly what the generator emits for a directly scoped table.
  ALTER TABLE handshakes ALTER COLUMN organization_id
    SET DEFAULT NULLIF(current_setting('app.organization_id', true), '');

  ALTER TABLE handshakes ENABLE ROW LEVEL SECURITY;
  ALTER TABLE handshakes FORCE ROW LEVEL SECURITY;
  CREATE POLICY handshakes_tenant ON handshakes
    USING ("organization_id" = current_setting('app.organization_id'))
    WITH CHECK ("organization_id" = current_setting('app.organization_id'));

  CREATE ROLE app_role NOLOGIN;
  GRANT SELECT, INSERT, UPDATE, DELETE ON handshakes TO app_role;
  GRANT SELECT ON organizations TO app_role;
`);

/** One statement as the application role, with a given tenant setting. */
async function asApp<T = Record<string, unknown>>(organization: string, sql: string): Promise<T[]> {
  await db.exec('SET ROLE app_role');
  await db.query('SELECT set_config($1, $2, false)', ['app.organization_id', organization]);
  try {
    return (await db.query<T>(sql)).rows;
  } finally {
    await db.exec('RESET ROLE');
  }
}

/** The statement as the application actually writes it: no organization_id. */
const insert = (token: string) =>
  `INSERT INTO handshakes (token, site_id) VALUES ('${token}', 'site_1')`;

// ─── 1. the write goes through, and lands in the right hotel ──────────────────
await asApp('org_a', insert('token_a'));
assert.deepStrictEqual(
  await asApp('org_a', 'SELECT token, organization_id FROM handshakes'),
  [{ token: 'token_a', organization_id: 'org_a' }],
  'the row belongs to the tenant that wrote it, without the statement saying so',
);
console.log('  ok  an INSERT that never mentions the tenant lands in the right one');

// ─── 2. and nowhere else ─────────────────────────────────────────────────────
await asApp('org_b', insert('token_b'));
assert.deepStrictEqual(
  (await asApp<{ token: string }>('org_b', 'SELECT token FROM handshakes')).map((r) => r.token),
  ['token_b'],
  'the other hotel sees only its own, which is what the default must not weaken',
);
console.log('  ok  and one hotel still cannot see the other\'s rows');

// ─── 3. no tenant is an error, not an empty organization ─────────────────────
// The claim the NULLIF exists for. Without it the default would be '', which
// satisfies `'' = ''`, and the row would be written into no hotel at all.
await assert.rejects(
  () => asApp('', insert('token_none')),
  /row-level security/,
  'a write with no tenant established must fail, not land in an empty organization',
);
assert.strictEqual(
  (await asApp('org_a', "SELECT token FROM handshakes WHERE token = 'token_none'")).length,
  0,
  'and nothing was written',
);
console.log('  ok  a write with no tenant is refused, not filed under nothing');

await db.close();
console.log('rls-write-tenant: a row knows its tenant without being told twice');

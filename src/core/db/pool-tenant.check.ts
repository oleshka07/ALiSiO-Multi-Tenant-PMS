/**
 * The tenant is set on the connection that runs the statement.
 *
 *   node src/core/db/pool-tenant.check.ts
 *
 * Row-level security reads `current_setting('app.organization_id')`, and that
 * setting belongs to a CONNECTION, not to a request. The seam used to establish
 * it with one call through the pool and then run the statement with another:
 *
 *   await scopeToTenant(pool);        // checkout A, set, release A
 *   return pool.query(text, params);  // checkout B, run
 *
 * Two independent checkouts. With a single connection they are always the same
 * one, which is why this held in every test, in every check that used PGlite,
 * and on a quiet production server. Under concurrency they are not the same,
 * and it fails in both directions: onto a connection nobody set — rows silently
 * missing — or onto one another request left set to ITS organization, at which
 * point the policies work perfectly and hand over the other hotel's rows.
 *
 * Measured against a real Postgres before the fix, a pool of two and eight
 * tenants asking at once: 260 of 320 statements ran under the wrong
 * organization.
 *
 * What this file checks is checkout discipline, not SQL — so the pool below is
 * a fake, and deliberately so. A real database cannot be made to interleave on
 * demand, and PGlite is a single connection, so neither can reproduce the bug
 * on purpose. Each fake connection remembers the last tenant set on it and
 * answers with it, which is exactly what a Postgres session does; the hazard is
 * whether the seam sends both the setting and the statement to the same one.
 */
import assert from 'node:assert';
import { postgresSql, type PgConnection, type PgPool } from './postgres.ts';
import { runWithOrganization } from '../auth/tenant-context.ts';

/** A connection that remembers the tenant last set on it, as a session does. */
function makeConnection(id: number) {
  let tenant = '';
  let busy = false;
  return {
    id,
    get busy() { return busy; },
    take() { busy = true; },
    give() { busy = false; },
    async query(text: string, params?: unknown[]) {
      if (/set_config/.test(text)) {
        // By name: the seam sets more than one variable per checkout
        // (app.organization_id and app.guest_token), and a fake that treats
        // them all as the tenant reports a failure the real code does not have.
        const [name, value] = params as [string, string];
        if (name === 'app.organization_id') tenant = String(value);
        return { rows: [], rowCount: 0 };
      }
      // Yield, so a concurrent chain gets a chance to interleave here — this is
      // the window the old code lost the connection in.
      await new Promise((r) => setImmediate(r));
      return { rows: [{ org: tenant, conn: id }], rowCount: 1 };
    },
  };
}

/** A pool that hands out whichever connection is free, as `pg` does. */
function makePool(size: number): PgPool & { inUse: () => number } {
  const conns = Array.from({ length: size }, (_, i) => makeConnection(i));
  const waiting: ((c: (typeof conns)[number]) => void)[] = [];

  const acquire = (): Promise<(typeof conns)[number]> => {
    const free = conns.find((c) => !c.busy);
    if (free) { free.take(); return Promise.resolve(free); }
    return new Promise((resolve) => waiting.push(resolve));
  };
  const release = (c: (typeof conns)[number]) => {
    const next = waiting.shift();
    if (next) next(c);
    else c.give();
  };

  return {
    inUse: () => conns.filter((c) => c.busy).length,
    // The pool's own query(): checkout, run, release — the shape that made the
    // setting and the statement land on different connections.
    async query(text: string, params?: unknown[]) {
      const c = await acquire();
      try { return await c.query(text, params); } finally { release(c); }
    },
    async connect(): Promise<PgConnection> {
      const c = await acquire();
      return {
        query: (text, params) => c.query(text, params),
        release: () => release(c),
      };
    },
  };
}

/** Ask, through the seam, which tenant the connection running this query has. */
async function whoAmI(sql: ReturnType<typeof postgresSql>, org: string) {
  return runWithOrganization(org, async () => {
    const row = await sql.row<{ org: string }>("SELECT current_setting('app.organization_id') AS org");
    return { asked: org, answered: row?.org ?? '(unset)' };
  });
}

// ─── one at a time: the case that always worked ──────────────────────────────
{
  const sql = postgresSql(makePool(2));
  for (const org of ['org_a', 'org_b', 'org_c']) {
    const r = await whoAmI(sql, org);
    assert.strictEqual(r.answered, r.asked, 'sequentially, the tenant is the caller\'s');
  }
  console.log('  ok  one request at a time reads its own tenant');
}

// ─── many at once, over fewer connections than callers ───────────────────────
{
  const pool = makePool(2);
  const sql = postgresSql(pool);
  const tenants = Array.from({ length: 8 }, (_, i) => `org_${i}`);

  const wrong: string[] = [];
  for (let round = 0; round < 25; round++) {
    const results = await Promise.all(tenants.map((o) => whoAmI(sql, o)));
    for (const r of results) {
      if (r.answered !== r.asked) wrong.push(`${r.asked} → ${r.answered}`);
    }
  }

  assert.deepStrictEqual(
    wrong.slice(0, 5), [],
    `a statement ran under another tenant's setting (${wrong.length} of 200): ${wrong.slice(0, 3).join(', ')}`,
  );
  console.log('  ok  eight tenants over two connections, none reads another\'s');
  assert.strictEqual(pool.inUse(), 0, 'every connection is returned to the pool');
  console.log('  ok  and nothing is left checked out');
}

// ─── a transaction keeps its one connection ──────────────────────────────────
// `tx` checks a connection out itself and passes a scoped handle; the fix must
// not make the statements inside it check out a second one, or BEGIN and COMMIT
// land on different connections again.
{
  const pool = makePool(2);
  const sql = postgresSql(pool);
  const seen = await runWithOrganization('org_tx', () =>
    sql.tx(async (t) => {
      const a = await t.row<{ conn: number }>('SELECT 1');
      const b = await t.row<{ conn: number }>('SELECT 2');
      return [a?.conn, b?.conn];
    }));
  assert.strictEqual(seen[0], seen[1], 'both statements ran on the same connection');
  assert.strictEqual(pool.inUse(), 0, 'the transaction released its connection');
  console.log('  ok  a transaction stays on one connection and gives it back');
}

console.log('pool-tenant: the setting and the statement go to the same connection');

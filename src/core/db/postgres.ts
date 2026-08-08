/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Sql, Dialect } from './async.ts';
import { currentOrganizationId } from '../auth/tenant-context.ts';

/**
 * The `Sql` seam over Postgres.
 *
 * Everything the modules call is already written against `Sql` — four methods,
 * positional parameters, `?` placeholders. This is the second implementation of
 * that interface, and it is the only file that knows Postgres exists.
 *
 * Three things it has to get right, and each one is a way to lose data or leak
 * it if got wrong:
 *
 *   1. Placeholders. The seam writes `?`; Postgres wants `$1, $2`. Translating
 *      by counting question marks would corrupt any query containing one inside
 *      a string literal — `WHERE note LIKE '%?%'` — so the rewrite walks the
 *      text and skips quoted sections.
 *
 *   2. Transactions need ONE connection. `pool.query()` picks an arbitrary
 *      connection per call, so BEGIN and COMMIT issued through the pool can
 *      land on different ones: the work commits nothing and the connection is
 *      returned to the pool still inside a transaction. `tx` checks a
 *      connection out and every statement inside it goes through that.
 *
 *   3. Row-level security. The policies in db/postgres/schema.sql read
 *      `current_setting('app.organization_id')`. Without it a query returns no
 *      rows — which is the safe direction, but only if the parameter is set for
 *      the connection actually running the query. It is set per checkout, from
 *      the ambient tenant context, so a handler that forgot to scope its SQL
 *      still cannot read another organization's rows.
 */

/**
 * The shape a value comes back in.
 *
 * The seam promises a module cannot tell which engine answered. Placeholders
 * and method names were the easy half; the types are the half that bites
 * silently. `pg` is careful where `better-sqlite3` was blunt, and every one of
 * these differences is a working screen that quietly stops working:
 *
 *   COUNT(*)   pg returns int8 as a STRING, because a bigint does not fit in a
 *              JavaScript number. SQLite returned a number. `count === 0` is
 *              false against '0', and `total + count` concatenates.
 *   money      NUMERIC likewise, for the same reason and with worse
 *              consequences — every sum in the finance module.
 *   timestamps pg builds a Date object. SQLite returned text, and 44 places in
 *              this codebase slice these as strings.
 *   flags      pg returns true/false where SQLite returned 1/0.
 *
 * So each is converted back to what SQLite gave. The ceiling is stated rather
 * than hidden: an id or a count past 2^53 would lose precision as a number, and
 * NUMERIC is read as a float — which is exactly what SQLite did, money being
 * REAL there, so this changes nothing and fixes nothing about that.
 */
export const SHAPES = {
  /** int8 — counts, sums over integers, and the identity keys. */
  int8: (v: string) => Number(v),
  /** NUMERIC — money. A float, as it was under SQLite. */
  numeric: (v: string) => Number(v),
  /** A flag, as the integer SQLite stored. */
  bool: (v: string) => (v === 't' ? 1 : 0),
  /** A calendar day stays 'YYYY-MM-DD'; the default parser makes a Date. */
  date: (v: string) => v,
  /**
   * 'YYYY-MM-DD HH:MM:SS', UTC — the shape SQLite's CURRENT_TIMESTAMP wrote.
   *
   * Everything in these columns was written as UTC (see scripts/pg-convert.mjs,
   * which stated the zone on the way in for the same reason), so a value that
   * arrives without one is read as UTC rather than as the server's locale —
   * which would shift every timestamp by the server's offset.
   */
  timestamp: (v: string) => {
    let s = v.replace(' ', 'T');
    // Postgres writes the offset as '+00'. JavaScript's date format wants
    // '+00:00' and only some engines accept the short form, so it is completed
    // here rather than left to the runtime.
    if (!/([Zz]|[+-]\d{2}(:?\d{2})?)$/.test(s)) s += 'Z';
    else if (/[+-]\d{2}$/.test(s)) s += ':00';
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? v : d.toISOString().replace('T', ' ').slice(0, 19);
  },
};

/**
 * Teach `pg` those shapes. Called once, before the pool is built.
 *
 * The OIDs are from pg_type and are fixed by Postgres itself, not by a version
 * or an extension: 16 bool, 20 int8, 1082 date, 1114 timestamp, 1184
 * timestamptz, 1700 numeric.
 */
export function installShapes(
  types: { setTypeParser(oid: number, fn: (v: string) => unknown): void },
): void {
  types.setTypeParser(16, SHAPES.bool);
  types.setTypeParser(20, SHAPES.int8);
  types.setTypeParser(1082, SHAPES.date);
  types.setTypeParser(1114, SHAPES.timestamp);
  types.setTypeParser(1184, SHAPES.timestamp);
  types.setTypeParser(1700, SHAPES.numeric);
}

/** The little of `pg` this file needs — so a test can pass something else. */
export interface PgClient {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
  /**
   * A script of several statements. Postgres only accepts those over the
   * SIMPLE query protocol, which is what `pg` uses when query() is called
   * without parameters — but a driver that always uses the extended protocol
   * (PGlite does) needs a separate entry point, so the interface names one.
   */
  exec?(text: string): Promise<unknown>;
}
export interface PgConnection extends PgClient {
  release(): void;
}
export interface PgPool extends PgClient {
  connect(): Promise<PgConnection>;
}

/**
 * `?` → `$1, $2, …`, skipping anything inside quotes.
 *
 * Single quotes are SQL strings, double quotes are identifiers, and a doubled
 * quote inside either is an escaped quote rather than the end of it. Dollar
 * quoting ($$…$$) does not appear in this codebase and is not handled; if it
 * ever does, it goes here.
 */
export function toDollarParams(sql: string): string {
  let out = '';
  let n = 0;
  let quote: string | null = null;

  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];

    if (quote) {
      out += c;
      if (c === quote) {
        if (sql[i + 1] === quote) { out += sql[++i]; }   // an escaped quote
        else quote = null;
      }
      continue;
    }

    if (c === "'" || c === '"') { quote = c; out += c; continue; }
    if (c === '?') { out += `$${++n}`; continue; }
    out += c;
  }
  return out;
}

/** Set the tenant for this connection, so RLS has something to match on. */
async function scopeToTenant(client: PgClient): Promise<void> {
  const org = currentOrganizationId();
  // set_config with a parameter, not string interpolation: the organization id
  // comes from a session and must never be pasted into SQL.
  await client.query('SELECT set_config($1, $2, false)', ['app.organization_id', org ?? '']);
}

/**
 * Postgres stores these columns as TIMESTAMPTZ, so the date functions are the
 * standard ones rather than SQLite's string formatters.
 *
 * dayOfWeek follows the SQLite convention (0 = Sunday) because the callers do;
 * EXTRACT(DOW) happens to agree.
 */
const POSTGRES_DIALECT: Dialect = {
  month: (column) => `to_char(${column}, 'YYYY-MM')`,
  dayOfWeek: (column) => `EXTRACT(DOW FROM ${column})::int`,
  tables: () => "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'",
  plusMinutes: (column, minutes) => `${column} + (${minutes}) * INTERVAL '1 minute'`,
};

/**
 * Run one statement with the tenant set on the connection that runs it.
 *
 * This used to be two calls through the pool:
 *
 *   await scopeToTenant(pool);                  // checkout A, set, release A
 *   return pool.query(text, params);            // checkout B, run
 *
 * which are two independent checkouts. The setting landed on A and the query
 * ran on whichever connection the pool handed out next. With one connection
 * they are always the same and everything works, which is why this survived
 * every test and every quiet moment on production.
 *
 * Under concurrency they are not the same, and it fails in both directions: the
 * query runs on a connection nobody set (rows silently missing) or on one that
 * ANOTHER REQUEST left set to ITS organization — and then the policies do
 * exactly what they are told and hand over that hotel's rows. Measured against
 * a real Postgres with a pool of two and eight tenants asking at once: 260 of
 * 320 statements ran under the wrong organization.
 *
 * So the connection is checked out once, here, and the setting and the
 * statement both go to it. That is also one checkout instead of two.
 *
 * `scoped` means the caller already owns a connection and already set the
 * tenant on it — inside `tx`, where every statement must stay on the one
 * connection the transaction began on.
 */
function methods(client: PgClient, scoped: boolean): Sql {
  const withTenant = async <T>(fn: (c: PgClient) => Promise<T>): Promise<T> => {
    if (scoped) return fn(client);
    const pool = client as PgPool;
    // A driver with no pool (PGlite in the checks) is a single connection, so
    // setting the tenant on it IS setting it on the one that runs the query.
    if (typeof pool.connect !== 'function') {
      await scopeToTenant(client);
      return fn(client);
    }
    const conn = await pool.connect();
    try {
      await scopeToTenant(conn);
      return await fn(conn);
    } finally {
      conn.release();
    }
  };

  const run = async (text: string, params: unknown[] = []) =>
    withTenant((c) => c.query(toDollarParams(text), params));

  return {
    dialect: POSTGRES_DIALECT,

    async rows<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
      return (await run(text, params)).rows as T[];
    },

    async row<T = any>(text: string, params: unknown[] = []): Promise<T | undefined> {
      return (await run(text, params)).rows[0] as T | undefined;
    },

    async run(text: string, params: unknown[] = []) {
      const r = await run(text, params);
      // Postgres does not hand back a generated id unless asked. A caller that
      // needs one writes RETURNING id and reads it from `rows` — `lastId` is
      // filled here only when the statement already returned something.
      const first = r.rows[0] as Record<string, unknown> | undefined;
      return {
        changes: r.rowCount ?? 0,
        lastId: (first?.id ?? undefined) as string | number | undefined,
      };
    },

    async exec(text: string) {
      await withTenant(async (c) => {
        if (c.exec) await c.exec(text);
        else await c.query(text);
      });
    },

    async tx<T>(): Promise<T> {
      throw new Error('nested transaction: use the handle the callback was given');
    },
  };
}

export function postgresSql(pool: PgPool): Sql {
  const outer = methods(pool, false);

  return {
    ...outer,

    async tx<T>(fn: (t: Sql) => Promise<T>): Promise<T> {
      // One connection for the whole transaction — see the note at the top.
      const client = await pool.connect();
      try {
        await scopeToTenant(client);
        await client.query('BEGIN');
        try {
          const out = await fn(methods(client, true));
          await client.query('COMMIT');
          return out;
        } catch (e) {
          try { await client.query('ROLLBACK'); } catch { /* already rolled back */ }
          throw e;
        }
      } finally {
        client.release();
      }
    },
  };
}

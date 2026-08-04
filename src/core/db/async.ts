/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDb } from './index.ts';

/**
 * The database, asked asynchronously.
 *
 * Why this exists: the app talks to SQLite through `better-sqlite3`, which is
 * SYNCHRONOUS — `db.prepare(sql).get(...)` returns a row, not a promise. Every
 * Postgres driver is asynchronous, because it talks over a socket. So the
 * Postgres schema in `db/postgres/` — generated, and proved to isolate tenants
 * by `rls-check.sql` — cannot be connected to anything: 1 440 call sites in
 * 180 files would all have to change on the same day.
 *
 * This is the seam that makes that a gradual move instead of one weekend that
 * either works or does not:
 *
 *   - `Sql` is the only shape modules are allowed to depend on. Four methods,
 *     all returning promises, all taking positional parameters.
 *   - `sqliteSql()` implements it on the CURRENT database. A module rewritten
 *     to `await sql.rows(...)` keeps working today, on SQLite, with no
 *     Postgres anywhere. That is what makes the migration reviewable: each
 *     module moves in its own commit and is verified in its own commit.
 *   - a Postgres implementation lands later behind the same interface, and the
 *     only thing that changes is which factory `getSql()` returns.
 *
 * Placeholders are written `?`. Postgres wants `$1, $2` — that translation
 * belongs in the Postgres implementation, not in 1 440 queries.
 */

export interface Sql {
  /** Every matching row. */
  rows<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  /** The first matching row, or undefined. */
  row<T = any>(sql: string, params?: unknown[]): Promise<T | undefined>;
  /** A statement that writes. Returns how many rows it changed. */
  run(sql: string, params?: unknown[]): Promise<{ changes: number; lastId?: string | number }>;
  /**
   * Several statements at once, no parameters — schema only.
   *
   * `run` prepares, and a prepared statement is exactly one statement; a
   * CREATE TABLE block separated by semicolons fails with "the supplied SQL
   * string contains more than one statement". Both drivers can execute a
   * script directly, so the seam names that rather than making every caller
   * split its own DDL.
   */
  exec(sql: string): Promise<void>;
  /**
   * Several statements, all or nothing.
   *
   * The callback receives a handle scoped to the transaction; using the outer
   * `sql` inside it would run outside the transaction, so it is not passed.
   */
  tx<T>(fn: (t: Sql) => Promise<T>): Promise<T>;
}

/**
 * The current database behind the future interface.
 *
 * better-sqlite3 is synchronous, so nothing here actually waits — the promises
 * resolve immediately. That is the point: the call SHAPE is what the migration
 * needs to change, and it can change now, before Postgres exists.
 */
export function sqliteSql(db: any = null): Sql {
  const handle = () => db || getDb();

  const impl: Sql = {
    async rows<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
      return handle().prepare(sql).all(...params) as T[];
    },

    async row<T = any>(sql: string, params: unknown[] = []): Promise<T | undefined> {
      return handle().prepare(sql).get(...params) as T | undefined;
    },

    async run(sql: string, params: unknown[] = []) {
      const r = handle().prepare(sql).run(...params);
      return { changes: r.changes as number, lastId: r.lastInsertRowid as number };
    },

    async exec(sql: string) {
      handle().exec(sql);
    },

    async tx<T>(fn: (t: Sql) => Promise<T>): Promise<T> {
      const d = handle();
      // better-sqlite3's own db.transaction() cannot wrap an async callback —
      // it commits when the function RETURNS, which for an async function is
      // the moment it awaits, not the moment it finishes. Hence the explicit
      // statements: they are what makes an await inside a transaction safe.
      d.prepare('BEGIN').run();
      try {
        const out = await fn(sqliteSql(d));
        d.prepare('COMMIT').run();
        return out;
      } catch (e) {
        try { d.prepare('ROLLBACK').run(); } catch { /* already rolled back */ }
        throw e;
      }
    },
  };
  return impl;
}

/**
 * The handle a module should ask for.
 *
 * One function to change when Postgres arrives — everything above it is
 * already written against the interface.
 */
export function getSql(): Sql {
  return sqliteSql();
}

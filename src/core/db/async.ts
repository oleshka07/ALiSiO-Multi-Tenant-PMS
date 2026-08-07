/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRequire } from 'node:module';

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

  /**
   * The handful of expressions the two engines genuinely spell differently.
   *
   * Almost all SQL in this codebase is portable once the placeholders are, and
   * where a SQLite spelling had a standard equivalent it was simply replaced —
   * `datetime('now')` became `CURRENT_TIMESTAMP`, `WHERE rowid = ?` became
   * `RETURNING`. These are what is left after that: cases with no shared
   * spelling at all, because the column types differ. `paid_at` is TEXT in
   * SQLite and TIMESTAMPTZ in Postgres, so `substr(paid_at, 1, 7)` works on one
   * and `to_char(paid_at, 'YYYY-MM')` on the other, and neither works on both.
   *
   * Naming them here keeps the divergence in one file instead of scattering
   * `if (postgres)` through twenty reports.
   */
  readonly dialect: Dialect;
}

export interface Dialect {
  /** 'YYYY-MM' of a timestamp column, for grouping by month. */
  month(column: string): string;
  /** Day of the week as a number, 0 = Sunday — the SQLite convention. */
  dayOfWeek(column: string): string;
}

/**
 * The current database behind the future interface.
 *
 * better-sqlite3 is synchronous, so nothing here actually waits — the promises
 * resolve immediately. That is the point: the call SHAPE is what the migration
 * needs to change, and it can change now, before Postgres exists.
 */
/** SQLite stores these columns as TEXT, so its own date functions apply. */
const SQLITE_DIALECT: Dialect = {
  month: (column) => `strftime('%Y-%m', ${column})`,
  dayOfWeek: (column) => `CAST(strftime('%w', ${column}) AS INTEGER)`,
};

export function sqliteSql(db: any = null): Sql {
  // Loaded on first use, not at import: `./index.ts` is the SQLite bootstrap —
  // the schema, every migration, better-sqlite3 and bcryptjs for the demo seed
  // — and a Postgres deployment must not drag any of it in. The Postgres
  // driver is loaded lazily for the mirror-image reason.
  const handle = () => {
    if (db) return db;
    const require = createRequire(import.meta.url);
    return require('./index.ts').getDb();
  };

  const impl: Sql = {
    dialect: SQLITE_DIALECT,

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
 * `DB_DRIVER=postgres` decides, and DATABASE_URL only supplies the connection
 * string. Two variables rather than one, on purpose: DATABASE_URL is already
 * set in .env.example, in both deploy templates and in at least one developer's
 * .env.local, left over from a scaffold and pointing at a Postgres that is not
 * running. Keying the engine on it alone means any of those switches a live
 * install the moment this ships — and the application cannot run on Postgres
 * yet (see scripts/check-dialect.mjs). An engine change should be something
 * someone typed, not something a stale line implies.
 *
 * The pool is built once and lazily: importing this file must not open a
 * connection, because scripts and checks import it without ever querying.
 */
let pgSql: Sql | null = null;

export function getSql(): Sql {
  if (process.env.DB_DRIVER !== 'postgres') return sqliteSql();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DB_DRIVER=postgres but DATABASE_URL is empty');

  if (!pgSql) {
    // Loaded here rather than imported at the top so a SQLite install never
    // pulls the driver in at all. createRequire, not a bare require(): this
    // file is an ES module, and node refuses a module that mixes the two.
    const require = createRequire(import.meta.url);
    const { Pool, types } = require('pg');
    const { postgresSql, installShapes } = require('./postgres.ts');
    // Before the pool: a connection opened first would parse its rows with the
    // defaults, and a count would come back as the string '0'.
    installShapes(types);
    pgSql = postgresSql(new Pool({ connectionString: url })) as Sql;
  }
  return pgSql;
}

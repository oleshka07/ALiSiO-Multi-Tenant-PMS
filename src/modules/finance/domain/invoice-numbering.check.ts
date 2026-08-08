/**
 * Invoice numbers are per organization — on both engines.
 *
 *   node src/modules/finance/domain/invoice-numbering.check.ts
 *
 * The claim being checked is the one that decides whether two hotels can share
 * a server at all: each of them issues 2026-001 as its first invoice of the
 * year, neither can advance the other's counter, and the two numbers coexist.
 *
 * Why it runs twice. This file used to run on SQLite alone, and it passed while
 * invoice numbering was completely broken on Postgres — because the two things
 * that broke it are things SQLite accepts and Postgres does not:
 *
 *   DO UPDATE SET last_no = last_no + 1    ambiguous between the target row and
 *                                          `excluded`; Postgres refuses
 *   COALESCE(period, issued_at)            TEXT and TIMESTAMPTZ have no common
 *                                          type; substr() over a timestamp the
 *                                          same
 *
 * Neither is a logic error, so no assertion here could have caught them on the
 * engine that tolerates them. The only fix that works is to run the same
 * assertions against the engine that does not — PGlite is real Postgres in this
 * process, so it costs a second and no Docker.
 */
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { PGlite } from '@electric-sql/pglite';
import { allocateInvoiceNumber, lockPeriod, isPeriodLocked, isInvoiceLocked } from './invoice-numbering.ts';
import { sqliteSql, type Sql } from '../../../core/db/async.ts';
import { postgresSql, type PgConnection } from '../../../core/db/postgres.ts';

const A = 'org_a';
const B = 'org_b';
const YEAR = 2026;

/** The same claims, whichever engine answered. */
async function claims(sql: Sql, engine: string, insertInvoice: (id: string, org: string, no: string) => Promise<void>) {
  // Each organization starts its own sequence at 1.
  const a1 = await allocateInvoiceNumber(sql, A, 'house', YEAR);
  const b1 = await allocateInvoiceNumber(sql, B, 'house', YEAR);
  assert.strictEqual(a1.invoiceNumber, '2026-001', `${engine}: A got ${a1.invoiceNumber}`);
  assert.strictEqual(b1.invoiceNumber, '2026-001', `${engine}: B got ${b1.invoiceNumber} — it read A's counter`);

  // The identical numbers coexist: the UNIQUE is (organization_id, number).
  await insertInvoice('a1', A, a1.invoiceNumber);
  await insertInvoice('b1', B, b1.invoiceNumber);
  await assert.rejects(
    () => insertInvoice('a1dup', A, a1.invoiceNumber),
    /unique|UNIQUE/i,
    `${engine}: a number was reused inside one organization`,
  );

  // A's second invoice is 002 regardless of how many B has issued. This is the
  // one that needs DO UPDATE — the first allocation only ever INSERTs.
  await allocateInvoiceNumber(sql, B, 'house', YEAR);
  await allocateInvoiceNumber(sql, B, 'house', YEAR);
  assert.strictEqual(
    (await allocateInvoiceNumber(sql, A, 'house', YEAR)).invoiceNumber, '2026-002',
    `${engine}: the counter did not advance`,
  );

  // Series are still independent within an organization.
  assert.strictEqual((await allocateInvoiceNumber(sql, A, 'booking', YEAR)).invoiceNumber, 'BKG-2026-001');

  // Locking a period is per organization too — and reaches the invoices in it.
  await lockPeriod(sql, A, 'HOUSE', '2026-01');
  assert.strictEqual(await isPeriodLocked(sql, A, 'HOUSE', '2026-01'), true);
  assert.strictEqual(await isPeriodLocked(sql, B, 'HOUSE', '2026-01'), false, `${engine}: A's lock froze B's period`);

  // isInvoiceLocked reads COALESCE(period, substr(issued_at)) — the other
  // spelling that only Postgres rejects.
  assert.strictEqual(typeof await isInvoiceLocked(sql, A, 'a1'), 'boolean', `${engine}: isInvoiceLocked threw`);

  console.log(`  ok  ${engine}: sequences, series and period locks are per organization`);
}

// ─── SQLite ─────────────────────────────────────────────────────────────────
{
  const db = new Database(':memory:');
  const sql = sqliteSql(db);
  await sql.exec(`
    CREATE TABLE invoice_counters (
      organization_id TEXT NOT NULL, series TEXT NOT NULL, year INTEGER NOT NULL,
      last_no INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (organization_id, series, year)
    );
    CREATE TABLE invoice_periods (
      organization_id TEXT NOT NULL, series TEXT NOT NULL, month TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', locked_at TEXT,
      PRIMARY KEY (organization_id, series, month)
    );
    CREATE TABLE invoices (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, invoice_number TEXT NOT NULL,
      series TEXT, period TEXT, issued_at TEXT, locked INTEGER NOT NULL DEFAULT 0,
      UNIQUE (organization_id, invoice_number)
    );
  `);
  await claims(sql, 'sqlite', (id, org, no) =>
    sql.run('INSERT INTO invoices (id, organization_id, invoice_number) VALUES (?, ?, ?)', [id, org, no]));
}

// ─── Postgres ───────────────────────────────────────────────────────────────
// The column types are the ones db/postgres/schema.sql actually declares:
// `period` TEXT and `issued_at` TIMESTAMPTZ. Declaring both TEXT here would
// make the file pass and prove nothing, which is exactly what happened before.
{
  const pg = new PGlite();
  const conn: PgConnection = {
    query: async (text, params) => {
      const r = await pg.query(text, params as any[]);
      return { rows: r.rows as any[], rowCount: (r as any).affectedRows ?? r.rows.length };
    },
    exec: (text) => pg.exec(text),
    release: () => { /* single connection */ },
  };
  const sql = postgresSql({ ...conn, connect: async () => conn });

  await sql.exec(`
    CREATE TABLE invoice_counters (
      organization_id TEXT NOT NULL, series TEXT NOT NULL, year BIGINT NOT NULL,
      last_no BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (organization_id, series, year)
    );
    CREATE TABLE invoice_periods (
      organization_id TEXT NOT NULL, series TEXT NOT NULL, month TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', locked_at TIMESTAMPTZ,
      PRIMARY KEY (organization_id, series, month)
    );
    CREATE TABLE invoices (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, invoice_number TEXT NOT NULL,
      series TEXT, period TEXT, issued_at TIMESTAMPTZ DEFAULT now(),
      locked BOOLEAN NOT NULL DEFAULT false,
      UNIQUE (organization_id, invoice_number)
    );
  `);
  await claims(sql, 'postgres', (id, org, no) =>
    sql.run('INSERT INTO invoices (id, organization_id, invoice_number) VALUES (?, ?, ?)', [id, org, no]));
  await pg.close();
}

console.log('invoice-numbering: the same claims hold on both engines');

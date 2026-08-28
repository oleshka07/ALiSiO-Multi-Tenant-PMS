/**
 * The `Sql` contract, proved on real Postgres.
 *
 *   node src/core/db/postgres.check.ts
 *
 * async.check.ts proves the same contract on SQLite. This file runs the same
 * claims against Postgres, because "both implementations satisfy the interface"
 * is the whole basis of the migration and neither half proves it alone.
 *
 * It uses PGlite — Postgres itself, compiled to WebAssembly, in this process.
 * Not a fake: same parser, same planner, same transaction semantics. That
 * matters because the two things most likely to be wrong here are transaction
 * scoping and placeholder rewriting, and a mock would happily agree with a
 * broken version of either.
 */
import assert from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { postgresSql, toDollarParams, SHAPES, type PgConnection, type PgPool } from './postgres.ts';
import { sqliteSql } from './async.ts';
import { runWithOrganization } from '../auth/tenant-context.ts';

// ─── Placeholder rewriting ──────────────────────────────────────────────────
// Done first and separately: it is pure string work, and a failure here would
// otherwise surface as a confusing SQL error further down.
assert.strictEqual(toDollarParams('SELECT * FROM t WHERE a = ? AND b = ?'),
  'SELECT * FROM t WHERE a = $1 AND b = $2');

assert.strictEqual(
  toDollarParams("SELECT * FROM t WHERE note LIKE '%?%' AND id = ?"),
  "SELECT * FROM t WHERE note LIKE '%?%' AND id = $1",
  'a question mark inside a string literal is data, not a placeholder',
);

assert.strictEqual(
  toDollarParams(`SELECT * FROM t WHERE q = 'it''s ? here' AND id = ?`),
  `SELECT * FROM t WHERE q = 'it''s ? here' AND id = $1`,
  'a doubled quote escapes the quote — the string has not ended',
);

assert.strictEqual(
  toDollarParams('SELECT "weird?col" FROM t WHERE id = ?'),
  'SELECT "weird?col" FROM t WHERE id = $1',
  'double quotes are an identifier, and may contain anything',
);

// ── Апостроф у коментарі ─────────────────────────────────────────────────
//
// Це не гіпотетичний випадок. Саме він поклав `/api/guest-registry` —
// «Evidenční kniha», реєстр, який читає поліція: у поясненні до запиту
// стояло `the registration form's own placeholder`, апостроф відкривав
// рядковий літерал, і `?` після нього не перетворювались. Postgres відповідав
// `syntax error at or near ")"`, а на SQLite усе працювало, бо там `?` і є
// плейсхолдер. Тобто ламалося рівно там, де живуть клієнти.
assert.strictEqual(
  toDollarParams("-- the form's own placeholder\nSELECT * FROM t WHERE id = ?"),
  "-- the form's own placeholder\nSELECT * FROM t WHERE id = $1",
  'апостроф у рядковому коментарі — це текст, а не початок літерала',
);

assert.strictEqual(
  toDollarParams("/* it's fine */ SELECT * FROM t WHERE id = ? AND b = ?"),
  "/* it's fine */ SELECT * FROM t WHERE id = $1 AND b = $2",
  'те саме для блокового коментаря, включно з багаторядковим',
);

// Коментар не має і ковтати плейсхолдери після себе.
assert.strictEqual(
  toDollarParams("SELECT a, -- ?\n b FROM t WHERE id = ?"),
  "SELECT a, -- ?\n b FROM t WHERE id = $1",
  'знак питання в коментарі — не плейсхолдер, а наступний за ним — плейсхолдер',
);
console.log('  ok  ? → $n, і не всередині лапок чи коментарів');

// ─── A pool of one, over PGlite ─────────────────────────────────────────────
// PGlite is a single connection. That is enough: `tx` needs the SAME connection
// throughout, and here every checkout returns the same one, which is exactly
// the property the transaction test cares about.
const pg = new PGlite();
const conn: PgConnection = {
  // PGlite names the count `affectedRows`; `pg` names it `rowCount`. The
  // adapter translates, because the interface is written to what `pg` returns.
  query: async (text, params) => {
    const r = await pg.query(text, params as any[]);
    return { rows: r.rows as any[], rowCount: (r as any).affectedRows ?? r.rows.length };
  },
  exec: (text) => pg.exec(text),
  release: () => { /* single connection: nothing to return */ },
};
const pool: PgPool = { query: conn.query, exec: conn.exec, connect: async () => conn };

const sql = postgresSql(pool);

await sql.exec(`
  CREATE TABLE probe (id SERIAL PRIMARY KEY, name TEXT, n INTEGER);
  CREATE TABLE scoped (id SERIAL PRIMARY KEY, organization_id TEXT NOT NULL, label TEXT);
`);

// ─── The same claims async.check.ts makes of SQLite ─────────────────────────
const ins = await sql.run('INSERT INTO probe (name, n) VALUES (?, ?)', ['a', 1]);
assert.strictEqual(ins.changes, 1, 'run did not report the row it inserted');

await sql.run('INSERT INTO probe (name, n) VALUES (?, ?)', ['b', 2]);
const all = await sql.rows<{ name: string; n: number }>('SELECT * FROM probe ORDER BY n');
assert.strictEqual(all.length, 2);
assert.strictEqual(all[0].name, 'a');

const one = await sql.row<{ name: string }>('SELECT * FROM probe WHERE n = ?', [2]);
assert.strictEqual(one?.name, 'b');

const missing = await sql.row('SELECT * FROM probe WHERE n = ?', [99]);
assert.strictEqual(missing, undefined, 'a missing row must be undefined, not null or a throw');
console.log('  ok  rows, row and run behave as the interface promises');

// A generated id comes back through RETURNING — Postgres has no lastInsertRowid.
const returned = await sql.run('INSERT INTO probe (name, n) VALUES (?, ?) RETURNING id', ['c', 3]);
assert.ok(returned.lastId, 'RETURNING id did not reach lastId');
console.log('  ok  a generated id arrives through RETURNING');

// ─── Transactions ───────────────────────────────────────────────────────────
await sql.tx(async (t) => {
  await t.run('INSERT INTO probe (name, n) VALUES (?, ?)', ['d', 4]);
  await t.run('INSERT INTO probe (name, n) VALUES (?, ?)', ['e', 5]);
});
assert.strictEqual((await sql.rows('SELECT * FROM probe')).length, 5, 'committed rows are missing');

let threw = false;
try {
  await sql.tx(async (t) => {
    await t.run('INSERT INTO probe (name, n) VALUES (?, ?)', ['f', 6]);
    await new Promise((r) => setTimeout(r, 5));
    throw new Error('deliberate');
  });
} catch { threw = true; }
assert.ok(threw, 'tx swallowed the error');
assert.strictEqual((await sql.rows('SELECT * FROM probe')).length, 5,
  'a rolled-back transaction left rows behind');
console.log('  ok  a transaction that throws after an await rolls back whole');

const seen = await sql.tx(async (t) => {
  await t.run('INSERT INTO probe (name, n) VALUES (?, ?)', ['g', 7]);
  return t.row<{ name: string }>('SELECT * FROM probe WHERE n = ?', [7]);
});
assert.strictEqual(seen?.name, 'g', 'a transaction could not read its own write');

// ─── The tenant reaches the connection ──────────────────────────────────────
// The RLS policies in db/postgres/schema.sql all read this parameter. If the
// ambient organization does not reach the connection, every policy matches
// nothing and the application looks empty — or, if it were set from the wrong
// place, matches someone else.
await runWithOrganization('org_probe', async () => {
  await sql.run('INSERT INTO scoped (organization_id, label) VALUES (?, ?)', ['org_probe', 'mine']);
  const setting = await sql.row<{ v: string }>("SELECT current_setting('app.organization_id', true) AS v");
  assert.strictEqual(setting?.v, 'org_probe', 'the ambient organization did not reach the connection');
});

await runWithOrganization('org_other', async () => {
  const setting = await sql.row<{ v: string }>("SELECT current_setting('app.organization_id', true) AS v");
  assert.strictEqual(setting?.v, 'org_other', 'the connection kept the previous tenant');
});

// Inside a transaction too — that is a different connection checkout.
await runWithOrganization('org_tx', async () => {
  const v = await sql.tx(async (t) =>
    (await t.row<{ v: string }>("SELECT current_setting('app.organization_id', true) AS v"))?.v);
  assert.strictEqual(v, 'org_tx', 'a transaction ran without the tenant set');
});
console.log('  ok  the ambient organization reaches every connection, transactions included');

// ─── The dialect fragments agree ────────────────────────────────────────────
// `strftime('%Y-%m', paid_at)` and `to_char(paid_at, 'YYYY-MM')` are two
// spellings of one idea, and every monthly report groups by it. If they ever
// disagreed the numbers would simply land in different months — no error, just
// wrong revenue. So the two are run side by side on the same instant.
{
  const Database = (await import('better-sqlite3')).default;
  const lite = new Database(':memory:');
  lite.exec("CREATE TABLE d (ts TEXT); INSERT INTO d VALUES ('2026-03-09 14:25:00')");
  const liteSql = sqliteSql(lite);

  await sql.exec("CREATE TABLE d (ts TIMESTAMPTZ); INSERT INTO d VALUES ('2026-03-09 14:25:00+00')");

  const liteMonth = (await liteSql.row<{ m: string }>(`SELECT ${liteSql.dialect.month('ts')} AS m FROM d`))?.m;
  const pgMonth = (await sql.row<{ m: string }>(`SELECT ${sql.dialect.month('ts')} AS m FROM d`))?.m;
  assert.strictEqual(liteMonth, '2026-03', 'SQLite month fragment');
  assert.strictEqual(pgMonth, liteMonth, 'the two engines group into different months');

  // 2026-03-09 is a Monday: 1 under both conventions.
  const liteDow = (await liteSql.row<{ d: number }>(`SELECT ${liteSql.dialect.dayOfWeek('ts')} AS d FROM d`))?.d;
  const pgDow = (await sql.row<{ d: number }>(`SELECT ${sql.dialect.dayOfWeek('ts')} AS d FROM d`))?.d;
  assert.strictEqual(Number(liteDow), 1, 'SQLite day-of-week fragment');
  assert.strictEqual(Number(pgDow), Number(liteDow), 'the two engines number weekdays differently');

  // The calendar day of a moment. The day close FILTERS by it, so that is what
  // is asserted — not what it prints. Selecting it gives a string on SQLite and
  // a Date on Postgres, which is exactly why `day()` is documented as a
  // comparison and never read back as a value.
  //
  // A disagreement here would put an invoice on the wrong day's sheet, and a
  // sheet wrong by one document is one nobody trusts again.
  const liteHit = await liteSql.row<any>(`SELECT 1 AS hit FROM d WHERE ${liteSql.dialect.day('ts')} = ?`, ['2026-03-09']);
  const pgHit = await sql.row<any>(`SELECT 1 AS hit FROM d WHERE ${sql.dialect.day('ts')} = ?`, ['2026-03-09']);
  assert.ok(liteHit, 'SQLite did not match the moment to its own day');
  assert.ok(pgHit, 'Postgres did not match the moment to the day SQLite matched');

  const liteMiss = await liteSql.row<any>(`SELECT 1 AS hit FROM d WHERE ${liteSql.dialect.day('ts')} = ?`, ['2026-03-10']);
  const pgMiss = await sql.row<any>(`SELECT 1 AS hit FROM d WHERE ${sql.dialect.day('ts')} = ?`, ['2026-03-10']);
  assert.ok(!liteMiss && !pgMiss, 'the neighbouring day must not match on either engine');

  lite.close();
  console.log('  ok  month, weekday and calendar day mean the same thing on both engines');
}

// ── A row comes back in the shape SQLite gave ────────────────────────────────
// These are what `pg` hands over before the seam converts them. Getting one
// wrong is not an error anyone sees: a count becomes the string '0', `=== 0`
// stops being true, and a total built with + becomes '0500' instead of 500.
{
  assert.strictEqual(SHAPES.int8('0'), 0, 'a count must be a number, not the string zero');
  assert.strictEqual(SHAPES.int8('42'), 42);
  assert.strictEqual(SHAPES.numeric('1250.50'), 1250.5, 'money must arrive as a number');
  assert.strictEqual(SHAPES.bool('t'), 1, 'a flag is 1, the way SQLite stored it');
  assert.strictEqual(SHAPES.bool('f'), 0);
  assert.strictEqual(SHAPES.date('2026-03-09'), '2026-03-09', 'a calendar day stays text');

  // Written by CURRENT_TIMESTAMP under SQLite, so UTC, so this is UTC.
  assert.strictEqual(SHAPES.timestamp('2026-03-09 14:25:00+00'), '2026-03-09 14:25:00');
  assert.strictEqual(SHAPES.timestamp('2026-03-09 14:25:00'), '2026-03-09 14:25:00',
    'a value with no zone is UTC, not the server locale');
  assert.strictEqual(SHAPES.timestamp('2026-03-09 16:25:00+02'), '2026-03-09 14:25:00',
    'an offset is applied, not ignored');
  assert.strictEqual(SHAPES.timestamp('not a date'), 'not a date', 'garbage passes through unchanged');

  // The failure this was written for: 44 places slice these as strings.
  assert.strictEqual(SHAPES.timestamp('2026-03-09 14:25:00+00').slice(0, 10), '2026-03-09');
  console.log('  ok  counts, money, flags and timestamps arrive as they did from SQLite');
}

await pg.close();
console.log('postgres sql: the same contract as SQLite, on Postgres itself');

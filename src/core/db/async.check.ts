/**
 * The asynchronous database seam.
 *
 *   node src/core/db/async.check.ts
 *
 * This interface is what lets 1 440 synchronous call sites move to Postgres
 * one module at a time instead of all on the same day. Its contract has to
 * hold on the CURRENT database first, or the migration starts from a guess.
 *
 * What is asserted here is exactly what a module rewritten against `Sql` will
 * rely on — including the part that is easy to get wrong: a transaction that
 * contains an `await` must still roll back as one unit. better-sqlite3's own
 * db.transaction() cannot do that (it commits when the function returns, and
 * an async function returns at its first await), which is why `tx` issues
 * BEGIN/COMMIT itself.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-sql-'));
process.env.ALISIO_DATA_DIR = tmp;

const { getSql } = await import('./async.ts');
const sql = getSql();

await sql.run('CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY, name TEXT, n INTEGER)');
await sql.run('DELETE FROM probe');

// run → changes
const ins = await sql.run('INSERT INTO probe (name, n) VALUES (?, ?)', ['a', 1]);
assert.strictEqual(ins.changes, 1, 'run did not report the row it inserted');

// rows / row, with parameters
await sql.run('INSERT INTO probe (name, n) VALUES (?, ?)', ['b', 2]);
const all = await sql.rows<{ name: string; n: number }>('SELECT * FROM probe ORDER BY n');
assert.strictEqual(all.length, 2);
assert.strictEqual(all[0].name, 'a');

const one = await sql.row<{ name: string }>('SELECT * FROM probe WHERE n = ?', [2]);
assert.strictEqual(one?.name, 'b');

const missing = await sql.row('SELECT * FROM probe WHERE n = ?', [99]);
assert.strictEqual(missing, undefined, 'a missing row must be undefined, not null or a throw');

// A transaction that commits.
await sql.tx(async (t) => {
  await t.run('INSERT INTO probe (name, n) VALUES (?, ?)', ['c', 3]);
  await t.run('INSERT INTO probe (name, n) VALUES (?, ?)', ['d', 4]);
});
assert.strictEqual((await sql.rows('SELECT * FROM probe')).length, 4, 'committed rows are missing');

// A transaction that throws AFTER an await — the case better-sqlite3's own
// transaction() gets wrong, and the reason this method exists.
let threw = false;
try {
  await sql.tx(async (t) => {
    await t.run('INSERT INTO probe (name, n) VALUES (?, ?)', ['e', 5]);
    await new Promise((r) => setTimeout(r, 5));
    throw new Error('deliberate');
  });
} catch {
  threw = true;
}
assert.ok(threw, 'tx swallowed the error');
const afterRollback = await sql.rows('SELECT * FROM probe');
assert.strictEqual(afterRollback.length, 4, 'a rolled-back transaction left rows behind');

// Reads inside a transaction see its own writes.
const seen = await sql.tx(async (t) => {
  await t.run('INSERT INTO probe (name, n) VALUES (?, ?)', ['f', 6]);
  return t.row<{ name: string }>('SELECT * FROM probe WHERE n = ?', [6]);
});
assert.strictEqual(seen?.name, 'f', 'a transaction could not read its own write');

try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
catch { /* Windows holds the file a moment; the OS temp dir cleans itself */ }

console.log('async sql: rows, row, run and a transaction that rolls back across an await');

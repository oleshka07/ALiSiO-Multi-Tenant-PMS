/**
 * The SQLite → Postgres value conversion, proved on both engines at once.
 *
 *   node scripts/pg-convert.check.mjs
 *
 * The import script's connection either works or fails loudly. The conversion
 * is the half that fails QUIETLY: a timestamp shifted by the server's offset,
 * a flag that becomes `true` for every row, an empty date that stops the import
 * two thirds of the way through.
 *
 * So each case is written into a real SQLite column, converted, written into
 * the real Postgres column the generated schema would create, and read back —
 * with PGlite, which is Postgres compiled to WebAssembly. No server, no mock.
 */
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { convert } from './pg-convert.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const lite = new Database(':memory:');
const pg = new PGlite();

// A table shaped like the ones the generator produces: a text id, a timestamp,
// a date, a 0/1 flag, money, and JSON in a text column.
lite.exec(`
  CREATE TABLE probe (
    id TEXT PRIMARY KEY,
    created_at TEXT,
    check_in TEXT,
    is_active INTEGER,
    amount REAL,
    config TEXT,
    note TEXT
  )
`);
await pg.exec(`
  CREATE TABLE probe (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ,
    check_in DATE,
    is_active BOOLEAN,
    amount NUMERIC(14,2),
    config JSONB,
    note TEXT
  )
`);

const TYPES = {
  id: 'text',
  created_at: 'timestamp with time zone',
  check_in: 'date',
  is_active: 'boolean',
  amount: 'numeric',
  config: 'jsonb',
  note: 'text',
};

/** Every shape SQLite actually stores in this database. */
const CASES = [
  {
    why: 'what CURRENT_TIMESTAMP writes: no zone, and it is UTC',
    row: { id: 'a', created_at: '2026-08-04 10:15:00', check_in: '2026-08-04', is_active: 1, amount: 1234.56, config: '{"x":1}', note: 'hello' },
    expect: { is_active: true, iso: '2026-08-04T10:15:00.000Z', amount: '1234.56' },
  },
  {
    why: 'an ISO string with an explicit zone must not gain a second one',
    row: { id: 'b', created_at: '2026-08-04T10:15:00.000Z', check_in: '2026-12-31', is_active: 0, amount: 0.1, config: '[]', note: '' },
    expect: { is_active: false, iso: '2026-08-04T10:15:00.000Z', amount: '0.10' },
  },
  {
    why: 'the empty string in a date column — SQLite allows it, Postgres does not',
    row: { id: 'c', created_at: '', check_in: '', is_active: null, amount: null, config: '', note: null },
    expect: { is_active: null, iso: null, amount: null },
  },
  {
    why: 'a flag stored as the STRING "1", which older rows have',
    row: { id: 'd', created_at: null, check_in: null, is_active: '1', amount: '99.99', config: null, note: 'x' },
    expect: { is_active: true, iso: null, amount: '99.99' },
  },
  {
    why: 'a text column holding something that is not JSON at all',
    row: { id: 'e', created_at: '2026-01-01 00:00:00', check_in: '2026-01-01', is_active: 0, amount: 0, config: 'not json', note: 'x' },
    expect: { is_active: false, iso: '2026-01-01T00:00:00.000Z', amount: '0.00' },
  },
];

const cols = Object.keys(TYPES);
const insert = lite.prepare(`INSERT INTO probe (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
for (const c of CASES) insert.run(...cols.map((k) => c.row[k]));

for (const c of CASES) {
  const stored = lite.prepare('SELECT * FROM probe WHERE id = ?').get(c.row.id);
  const values = cols.map((k) => convert(stored[k], TYPES[k]));
  await pg.query(
    `INSERT INTO probe (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
    values,
  );

  const back = (await pg.query('SELECT * FROM probe WHERE id = $1', [c.row.id])).rows[0];

  assert.strictEqual(back.is_active, c.expect.is_active, `is_active — ${c.why}`);

  const iso = back.created_at instanceof Date ? back.created_at.toISOString() : back.created_at;
  assert.strictEqual(iso ?? null, c.expect.iso, `created_at — ${c.why}`);

  assert.strictEqual(back.amount === null ? null : String(back.amount), c.expect.amount, `amount — ${c.why}`);
}
console.log('  ok  timestamps, flags, money and empty strings survive the crossing');

// The zone is the one that would be wrong everywhere and visible nowhere: a
// naive timestamp read in a server locale of UTC+2 lands two hours early, and
// every arrival report is quietly off by a day at the edges.
const naive = convert('2026-08-04 00:30:00', 'timestamp with time zone');
assert.ok(String(naive).endsWith('Z'), 'a zone-less timestamp was not marked UTC');
console.log('  ok  a timestamp without a zone is read as UTC, not as the server locale');

// JSON that is not JSON still has to land in a JSONB column.
const notJson = convert('not json', 'jsonb');
assert.strictEqual(notJson, '"not json"');
assert.doesNotThrow(() => JSON.parse(notJson));
console.log('  ok  a text column that is not JSON still becomes valid JSONB');

lite.close();
await pg.close();
console.log('pg import: every SQLite value shape lands correctly in Postgres');

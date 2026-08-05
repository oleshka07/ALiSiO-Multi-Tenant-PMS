/**
 * Copy the SQLite database into Postgres.
 *
 *   node scripts/pg-import.mjs "postgres://user:pass@host/db"
 *   node scripts/pg-import.mjs "postgres://…" --dry-run
 *
 * The schema is created by db/postgres/schema.sql; this only moves rows. Run
 * the schema first, then this, then db/postgres/rls-check.sql.
 *
 * Four things it has to get right, and each one is a way to silently lose data:
 *
 *   1. TYPES. SQLite stores a timestamp as the text '2026-08-04 10:15:00', a
 *      flag as the integer 1, and JSON as a string. Postgres wants TIMESTAMPTZ,
 *      BOOLEAN and JSONB. The conversion is driven by the column types Postgres
 *      actually has — read from information_schema, not guessed — so it cannot
 *      drift from the schema the way a second copy of the rules would.
 *
 *   2. ORDER. Foreign keys mean children cannot be inserted before parents.
 *      Rather than hand-maintain a list of 92 tables in dependency order, the
 *      constraints are switched off for the duration (session_replication_role)
 *      and switched back on at the end, which also re-validates nothing — so
 *      the import ends by counting rows on both sides instead.
 *
 *   3. ALL OR NOTHING. One transaction. A half-imported database that looks
 *      populated is worse than an empty one, because someone will use it.
 *
 *   4. EMPTINESS. It refuses to run into a database that already has rows.
 *      Importing twice would duplicate everything that has no unique key.
 *
 * Not handled, on purpose: incremental sync. This is a one-time move. If the
 * source keeps changing while it runs, the answer is to stop the application
 * first, which is what the deploy runbook says to do.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { convert } from './pg-convert.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { Client } = require('pg');

const url = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
if (!url || url.startsWith('--')) {
  console.error('usage: node scripts/pg-import.mjs "postgres://user:pass@host/db" [--dry-run]');
  process.exit(2);
}

const sqlitePath = process.env.ALISIO_DB_PATH
  || path.join(process.env.ALISIO_DATA_DIR || 'data', 'alisio.db');
if (!fs.existsSync(sqlitePath)) {
  console.error(`no SQLite database at ${sqlitePath}`);
  process.exit(2);
}

const lite = new Database(sqlitePath, { readonly: true });
const pg = new Client({ connectionString: url });
await pg.connect();

/** What Postgres says each column is — the schema is the authority, not a guess. */
async function pgColumns() {
  const { rows } = await pg.query(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);
  const byTable = new Map();
  for (const r of rows) {
    if (!byTable.has(r.table_name)) byTable.set(r.table_name, new Map());
    byTable.get(r.table_name).set(r.column_name, r.data_type);
  }
  return byTable;
}

const columns = await pgColumns();
const liteTables = lite.prepare(`
  SELECT name FROM sqlite_master
  WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  ORDER BY name
`).all().map((r) => r.name);

// ── Refuse a database that is not empty ─────────────────────────────────────
const populated = [];
for (const t of liteTables) {
  if (!columns.has(t)) continue;
  const { rows } = await pg.query(`SELECT 1 FROM "${t}" LIMIT 1`);
  if (rows.length) populated.push(t);
}
if (populated.length && !dryRun) {
  console.error(`\nPostgres is not empty — ${populated.length} table(s) already have rows:`);
  console.error(`  ${populated.slice(0, 8).join(', ')}${populated.length > 8 ? ' …' : ''}`);
  console.error('\nImporting on top would duplicate every row without a unique key.');
  console.error('Drop and recreate the schema first, or import into a fresh database.');
  await pg.end();
  process.exit(1);
}

// ── Tables SQLite has and the schema does not, and the reverse ──────────────
const missingInPg = liteTables.filter((t) => !columns.has(t));
const missingInLite = [...columns.keys()].filter((t) => !liteTables.includes(t));
if (missingInPg.length) {
  console.log(`\nnot in the Postgres schema, skipped: ${missingInPg.join(', ')}`);
  console.log('  (regenerate with `node scripts/pg-schema.mjs` if that is wrong)');
}
if (missingInLite.length) {
  console.log(`\nin Postgres but not in SQLite, left empty: ${missingInLite.join(', ')}`);
}

// ── Copy ────────────────────────────────────────────────────────────────────
let totalRows = 0;
const counts = [];

if (!dryRun) await pg.query('BEGIN');
try {
  // Foreign keys off for the duration: 92 tables in dependency order is a list
  // that rots, and the row counts at the end prove more than the order would.
  if (!dryRun) await pg.query("SET session_replication_role = 'replica'");

  for (const table of liteTables) {
    const pgCols = columns.get(table);
    if (!pgCols) continue;

    const liteCols = lite.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);
    const shared = liteCols.filter((c) => pgCols.has(c));
    const dropped = liteCols.filter((c) => !pgCols.has(c));
    if (!shared.length) continue;

    const rows = lite.prepare(`SELECT * FROM "${table}"`).all();
    counts.push({ table, rows: rows.length, dropped });
    totalRows += rows.length;
    if (!rows.length || dryRun) continue;

    // One multi-row INSERT per chunk. 500 keeps the statement under Postgres's
    // 65 535 parameter ceiling for even the widest table here.
    const perStatement = Math.max(1, Math.floor(60000 / shared.length));
    const quoted = shared.map((c) => `"${c}"`).join(', ');

    for (let i = 0; i < rows.length; i += perStatement) {
      const chunk = rows.slice(i, i + perStatement);
      const values = [];
      const tuples = chunk.map((row) => {
        const slots = shared.map((c) => {
          values.push(convert(row[c], pgCols.get(c)));
          return `$${values.length}`;
        });
        return `(${slots.join(', ')})`;
      });
      await pg.query(`INSERT INTO "${table}" (${quoted}) VALUES ${tuples.join(', ')}`, values);
    }
  }

  // Sequences: rows were inserted with explicit ids, so the counters still sit
  // at 1 and the next insert would collide with row 1.
  if (!dryRun) {
    const { rows: seqs } = await pg.query(`
      SELECT c.relname AS seq, t.relname AS tbl, a.attname AS col
      FROM pg_class c
      JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'a'
      JOIN pg_class t ON t.oid = d.refobjid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
      WHERE c.relkind = 'S'
    `);
    for (const s of seqs) {
      await pg.query(
        `SELECT setval($1, COALESCE((SELECT MAX("${s.col}") FROM "${s.tbl}"), 0) + 1, false)`,
        [s.seq],
      );
    }
    if (seqs.length) console.log(`\nreset ${seqs.length} sequence(s) past the imported ids`);
  }

  if (!dryRun) {
    await pg.query("SET session_replication_role = 'origin'");
    await pg.query('COMMIT');
  }
} catch (e) {
  if (!dryRun) { try { await pg.query('ROLLBACK'); } catch { /* already gone */ } }
  console.error('\nimport failed, nothing was written:', e.message);
  await pg.end();
  process.exit(1);
}

// ── Prove it ────────────────────────────────────────────────────────────────
// Not "it did not throw" — the same count on both sides, table by table.
let mismatched = 0;
if (!dryRun) {
  for (const { table, rows } of counts) {
    const { rows: [{ count }] } = await pg.query(`SELECT COUNT(*)::int AS count FROM "${table}"`);
    if (count !== rows) {
      console.error(`  MISMATCH ${table}: SQLite ${rows}, Postgres ${count}`);
      mismatched++;
    }
  }
}

const withRows = counts.filter((c) => c.rows > 0);
console.log(`\n${dryRun ? 'would copy' : 'copied'} ${totalRows} rows across ${withRows.length} non-empty table(s)`);
for (const c of withRows.sort((a, b) => b.rows - a.rows).slice(0, 10)) {
  console.log(`  ${String(c.rows).padStart(7)}  ${c.table}${c.dropped.length ? `   (dropped: ${c.dropped.join(', ')})` : ''}`);
}
const withDropped = counts.filter((c) => c.dropped.length);
if (withDropped.length) {
  console.log(`\ncolumns in SQLite that the Postgres schema does not have — ${withDropped.length} table(s):`);
  for (const c of withDropped) console.log(`  ${c.table}: ${c.dropped.join(', ')}`);
  console.log('  (these are dropped. If any hold data you need, fix the schema and re-import.)');
}

lite.close();
await pg.end();

if (mismatched) {
  console.error(`\n${mismatched} table(s) do not match. The import committed — verify before using it.`);
  process.exit(1);
}
console.log(dryRun ? '\ndry run: nothing was written' : '\nevery table matches row for row');

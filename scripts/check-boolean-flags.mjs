/**
 * A flag written as 0 or 1 into a column Postgres declares BOOLEAN.
 *
 *   node scripts/check-boolean-flags.mjs [--strict]
 *
 * The move to Postgres promoted SQLite's INTEGER 0/1 flags to real booleans —
 * deliberately (see pg-schema.mjs: "flags INTEGER 0/1 -> BOOLEAN"). The
 * application keeps its 0/1 model, and the seam translates on the way out:
 *
 *   bool: (v) => (v === 't' ? 1 : 0)      // postgres.ts, SHAPES
 *
 * Nothing translates on the way in, and nothing can: these values are not bound
 * parameters, they are integer literals written into the SQL text —
 *
 *   INSERT INTO additional_services (…, is_active, …) VALUES (…, 1, …)
 *   INSERT INTO coupons (…, is_active) VALUES (?,?,?,…,1)
 *
 * — so Postgres types them `integer` and refuses:
 *
 *   column "is_active" is of type boolean but expression is of type integer
 *   operator does not exist: boolean = integer          (in a WHERE clause)
 *
 * Both are hard failures, every time, and both are invisible on SQLite, which
 * has no boolean type at all and takes 0/1 and TRUE/FALSE as the same thing.
 * That is also the fix: TRUE and FALSE work on both engines, and the codebase
 * already writes `WHERE is_active = TRUE` in the places that were noticed.
 *
 * The boolean columns are read out of db/postgres/schema.sql rather than a live
 * database, so this runs in CI with nothing to connect to.
 */
import fs from 'node:fs';
import path from 'node:path';

// ── Which columns Postgres declares BOOLEAN ─────────────────────────────────
const SCHEMA = 'db/postgres/schema.sql';
const boolColumns = new Map();   // table → Set of column names
{
  let table = null;
  for (const line of fs.readFileSync(SCHEMA, 'utf8').split('\n')) {
    const open = line.match(/^CREATE TABLE "([^"]+)" \($/);
    if (open) { table = open[1]; continue; }
    if (!table) continue;
    if (line.startsWith(')')) { table = null; continue; }
    const col = line.match(/^\s+"([^"]+)"\s+BOOLEAN\b/);
    if (col) {
      if (!boolColumns.has(table)) boolColumns.set(table, new Set());
      boolColumns.get(table).add(col[1]);
    }
  }
}
const anyBoolColumn = new Set([...boolColumns.values()].flatMap((s) => [...s]));

// ── The SQL this codebase writes ────────────────────────────────────────────
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    // lib/db.ts is the SQLite schema builder: its CREATE TABLE and its seed
    // rows never reach Postgres, and its 0/1 defaults are correct there.
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.check.ts') && full !== 'src/lib/db.ts') files.push(full);
  }
})('src');

const findings = [];
const add = (file, offset, src, kind, detail) =>
  findings.push({ file, line: src.slice(0, offset).split('\n').length, kind, detail });

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');

  // ── INSERT: match the column list against the VALUES list by position ─────
  for (const m of src.matchAll(/INSERT\s+INTO\s+"?(\w+)"?\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/gis)) {
    const [, table, colText, valText] = m;
    const cols = boolColumns.get(table);
    if (!cols) continue;
    const columns = colText.split(',').map((c) => c.trim().replace(/"/g, ''));
    const values = valText.split(',').map((v) => v.trim());
    if (columns.length !== values.length) continue;   // a built list; the SET scan below still sees it
    columns.forEach((c, i) => {
      if (cols.has(c) && /^[01]$/.test(values[i])) {
        add(file, m.index, src, 'INSERT', `${table}.${c} = ${values[i]}`);
      }
    });
  }

  // ── SET and WHERE: `col = 1`, `col != 0`, `col <> 1` ─────────────────────
  // Matched on the column name alone, without knowing the statement's table:
  // a name like `is_active` belongs to a boolean column in every table that has
  // one, and there is no table where `is_active = 1` would be right.
  for (const m of src.matchAll(/\b(\w+)\s*(=|!=|<>)\s*([01])\b/g)) {
    const [, col, op, lit] = m;
    if (!anyBoolColumn.has(col)) continue;
    // Only inside something that looks like SQL — `is_active = 1` in TypeScript
    // is ordinary code assigning a flag to a plain object.
    const line = src.slice(src.lastIndexOf('\n', m.index) + 1, src.indexOf('\n', m.index));
    if (!/\b(SELECT|UPDATE|SET|WHERE|AND|OR|FROM|JOIN|INSERT)\b/i.test(line)) continue;
    add(file, m.index, src, op === '=' ? 'SET/WHERE' : 'WHERE', `${col} ${op} ${lit}`);
  }
}

console.log(`\nboolean-flags: ${anyBoolColumn.size} boolean-колонок у схемі, ${findings.length} місць із 0/1\n`);
for (const f of findings) {
  console.log(`  ${f.file}:${f.line}  [${f.kind}]  ${f.detail}`);
}
if (findings.length) {
  console.log(`\n  Postgres відхиляє і те, і те: у INSERT — "column is of type boolean but`);
  console.log(`  expression is of type integer", у WHERE — "operator does not exist:`);
  console.log(`  boolean = integer". TRUE/FALSE працюють на обох базах.\n`);
}

if (process.argv.includes('--strict') && findings.length) process.exit(1);

/**
 * An INSERT into a tenant table that does not name the tenant.
 *
 *   node scripts/check-insert-tenant.mjs [--strict]
 *
 * Migration 0005 gave every scoped table a column default:
 *
 *   ALTER TABLE "reservations" ALTER COLUMN "organization_id"
 *     SET DEFAULT NULLIF(current_setting('app.organization_id', true), '');
 *
 * That is a Postgres mechanism. SQLite has no equivalent and never will, and
 * SQLite is what every developer machine runs, what `npm run dev` opens, and
 * what the CI job that boots the application uses. So an INSERT that leaves
 * `organization_id` to the default writes a row with a NULL tenant there —
 * quietly. The insert answers 201. The list comes back empty. Nothing logs
 * anything, because nothing went wrong: a row with no tenant is a row no
 * tenant can see.
 *
 * This was true of all eight places that create a reservation. It surfaced only
 * when a new query scoped by `reservations.organization_id` and found nothing
 * on a database full of bookings.
 *
 * It is worse than a broken screen. On Postgres the same code depends on the
 * request having established a tenant; where a background job or an unguarded
 * path has not, the default silently produces NULL there too — and that row is
 * then invisible to its owner and to the policy that was supposed to protect
 * it.
 *
 * So: name the column. `INSERT INTO reservations (id, organization_id, …)`,
 * with the tenant from the session, or from the property the row hangs off:
 *
 *   VALUES (?, (SELECT organization_id FROM properties WHERE id = ?), …)
 *
 * Which tables count is read from db/postgres/schema.sql — anything with an
 * `organization_id` column — so this needs no list to maintain and no database
 * to connect to.
 */
import fs from 'node:fs';
import path from 'node:path';

const strict = process.argv.includes('--strict');

// ── Which tables carry a tenant column ──────────────────────────────────────
const SCHEMA = 'db/postgres/schema.sql';
const scoped = new Set();
{
  let table = null;
  for (const line of fs.readFileSync(SCHEMA, 'utf8').split('\n')) {
    const open = line.match(/^CREATE TABLE "([^"]+)" \($/);
    if (open) { table = open[1]; continue; }
    if (!table) continue;
    if (line.startsWith(')')) { table = null; continue; }
    if (/^\s+"organization_id"\s/.test(line)) scoped.add(table);
  }
}

// ── Where to look ───────────────────────────────────────────────────────────
const ROOTS = ['src/modules', 'src/core', 'src/app'];

/**
 * Files that legitimately insert without naming the tenant.
 *
 * `src/lib/db.ts` rebuilds tables inside migrations by copying a fixed column
 * list from the old shape to the new one; those statements describe a schema
 * that predates the column and adding it would be wrong, not right.
 */
const ALLOWED = new Set(['src/lib/db.ts']);

const files = [];
for (const root of ROOTS) walk(root);

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (/\.(ts|tsx|mts)$/.test(entry.name) && !entry.name.includes('.check.')) files.push(full);
  }
}

const findings = [];

for (const file of files) {
  if (ALLOWED.has(file)) continue;
  const source = fs.readFileSync(file, 'utf8');

  // `INSERT INTO <table> ( … )`. The column list may span lines and may hold
  // SQL comments; neither changes whether the tenant is named in it.
  const re = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+"?(\w+)"?\s*\(([^)]*)\)/gis;
  for (const m of source.matchAll(re)) {
    const [, table, columns] = m;
    if (!scoped.has(table)) continue;
    if (/\borganization_id\b/.test(columns)) continue;

    findings.push({
      file,
      line: source.slice(0, m.index).split('\n').length,
      table,
    });
  }
}

// ── Report ──────────────────────────────────────────────────────────────────
console.log('');
console.log('══════════════════════════════════════════════════════════════════════════════');
console.log('INSERT У ТАБЛИЦЮ З ОРЕНДАРЕМ, ЯКИЙ НЕ НАЗВАНО — має бути нуль');
console.log('══════════════════════════════════════════════════════════════════════════════');
console.log('');

if (findings.length === 0) {
  console.log(`  чисто — ${files.length} файлів, ${scoped.size} таблиць з organization_id`);
  console.log('');
  process.exit(0);
}

for (const f of findings) {
  console.log(`  ${f.file}:${f.line}  →  ${f.table}`);
}
console.log('');
console.log(`  разом: ${findings.length}`);
console.log('');
console.log('  На Postgres колонка має DEFAULT із app.organization_id (міграція 0005).');
console.log('  На SQLite такого механізму немає — рядок отримує NULL-орендаря, INSERT');
console.log('  відповідає 201, а список повертається порожнім. Назвіть колонку явно:');
console.log('  organization_id із сесії або (SELECT organization_id FROM properties …).');
console.log('');

process.exit(strict ? 1 : 0);
